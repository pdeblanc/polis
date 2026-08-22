import { BirdsEngine } from '../models/birds/birdsEngine';
import {
  BirdsCacheProfiler,
  type BirdsCacheFamily,
  type BirdsCacheTiming,
} from '../models/birds/cacheProfiling';
import { possibleFlowDestinations } from '../models/birds/motionSupport';
import { birdsScale } from '../models/birds/scales';
import {
  beginDistributionProfile,
  endDistributionProfile,
  type DistributionProfile,
  type ProfiledDistribution,
} from '../utils/distributions/profiling';

interface ProfileCase {
  readonly cache: 'cold' | 'warm';
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly query: 'cell' | 'flow';
}

const cases: readonly ProfileCase[] = [
  { query: 'cell', epoch: 2, diffusionRate: 0.5, cache: 'cold' },
  { query: 'cell', epoch: 2, diffusionRate: 0.5, cache: 'warm' },
  { query: 'flow', epoch: 0, diffusionRate: 0.5, cache: 'cold' },
  { query: 'flow', epoch: 2, diffusionRate: 0.5, cache: 'cold' },
  { query: 'flow', epoch: 2, diffusionRate: 0.5, cache: 'warm' },
  { query: 'flow', epoch: 3, diffusionRate: 0.5, cache: 'cold' },
  { query: 'flow', epoch: 2, diffusionRate: 2, cache: 'cold' },
];

const distributions: readonly ProfiledDistribution[] = [
  'binomial',
  'multinomial',
  'hypergeometric',
  'multivariateHypergeometric',
];

const summaries: object[] = [];
const details: object[] = [];
const cacheDetails: object[] = [];
const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const requestedCases = new Set(commandLine.process?.argv.slice(2) ?? []);
const selectedCases =
  requestedCases.size === 0
    ? cases
    : cases.filter((profileCase) => requestedCases.has(caseLabel(profileCase)));
if (selectedCases.length === 0) throw new RangeError('No Birds profile case matched');
for (const profileCase of selectedCases) {
  // Warm JIT paths separately so the baseline/profile comparison is not determined by
  // which mode happened to execute a query family first.
  runBaseline(profileCase);
  runProfiled(profileCase);
  const baselineMilliseconds = runBaseline(profileCase);
  const { cacheProfile, elapsedMilliseconds, profile } = runProfiled(profileCase);
  const label = caseLabel(profileCase);
  const cacheMilliseconds = [...cacheProfile.values()].reduce(
    (sum, timing) => sum + cacheTotalMilliseconds(timing),
    0,
  );
  summaries.push({
    case: label,
    baselineMilliseconds,
    profiledMilliseconds: elapsedMilliseconds,
    instrumentationRatio: elapsedMilliseconds / baselineMilliseconds,
    distributionMilliseconds: profile.distributionWallMilliseconds,
    distributionPercent: 100 * profile.distributionWallMilliseconds / elapsedMilliseconds,
    nonDistributionMilliseconds: elapsedMilliseconds - profile.distributionWallMilliseconds,
    nonDistributionPercent:
      100 * (elapsedMilliseconds - profile.distributionWallMilliseconds) / elapsedMilliseconds,
    cacheMilliseconds,
    cachePercent: 100 * cacheMilliseconds / elapsedMilliseconds,
  });
  for (const distribution of distributions) {
    const timing = profile.timings[distribution];
    if (timing.calls === 0) continue;
    details.push({
      case: label,
      distribution,
      calls: timing.calls,
      inclusiveMilliseconds: timing.inclusiveMilliseconds,
      exclusiveMilliseconds: timing.exclusiveMilliseconds,
      addressEncodingMilliseconds: timing.addressEncodingMilliseconds,
      hashingMilliseconds: timing.hashingMilliseconds,
      hashingPercentOfInclusive: 100 * timing.hashingMilliseconds / timing.inclusiveMilliseconds,
    });
  }
  for (const [family, timing] of cacheProfile) {
    cacheDetails.push({
      case: label,
      family,
      keys: timing.keys,
      keyMilliseconds: timing.keyMilliseconds,
      getHits: timing.getHits,
      getMisses: timing.getMisses,
      hitPercent: 100 * timing.getHits / (timing.getHits + timing.getMisses),
      getMilliseconds: timing.getMilliseconds,
      sets: timing.sets,
      setMilliseconds: timing.setMilliseconds,
      totalMilliseconds: cacheTotalMilliseconds(timing),
    });
  }
}

writeTable('query-summary', summaries);
writeTable('distribution-detail', details);
writeTable('cache-detail', cacheDetails);

function runBaseline(profileCase: ProfileCase): number {
  const { query } = prepare(profileCase);
  if (profileCase.cache === 'warm') query();
  const start = performance.now();
  query();
  return performance.now() - start;
}

function runProfiled(profileCase: ProfileCase): {
  readonly cacheProfile: ReadonlyMap<BirdsCacheFamily, BirdsCacheTiming>;
  readonly elapsedMilliseconds: number;
  readonly profile: DistributionProfile;
} {
  const cacheProfiler = new BirdsCacheProfiler();
  const { query } = prepare(profileCase, cacheProfiler);
  if (profileCase.cache === 'warm') {
    query();
    cacheProfiler.reset();
  }
  beginDistributionProfile();
  const start = performance.now();
  query();
  const elapsedMilliseconds = performance.now() - start;
  return {
    cacheProfile: cacheProfiler.snapshot(),
    elapsedMilliseconds,
    profile: endDistributionProfile(),
  };
}

function prepare(profileCase: ProfileCase, cacheProfiler?: BirdsCacheProfiler): {
  readonly engine: BirdsEngine;
  readonly query: () => void;
} {
  const scale = birdsScale(profileCase.epoch)!;
  const engine = new BirdsEngine(
    `Birds engine profile ${caseLabel(profileCase)}`,
    2,
    profileCase.diffusionRate,
    { cacheProfiler },
  );
  const source = { min: 0, max: scale.cellLength, time: 0 };
  if (profileCase.query === 'cell') {
    return { engine, query: () => void engine.queryCell(source) };
  }
  const destination = possibleFlowDestinations(
    source,
    scale.flowDuration,
    profileCase.diffusionRate,
  ).find(({ min }) => min === source.min);
  if (destination === undefined) throw new Error('Profile flow is unsupported');
  return { engine, query: () => void engine.queryFlow({ source, destination }) };
}

function cacheTotalMilliseconds(timing: BirdsCacheTiming): number {
  return timing.keyMilliseconds + timing.getMilliseconds + timing.setMilliseconds;
}

function caseLabel(profileCase: ProfileCase): string {
  return `${profileCase.query}-e${profileCase.epoch}-D${profileCase.diffusionRate}-${profileCase.cache}`;
}

function writeTable(name: string, rows: readonly object[]): void {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  console.log(`# ${name}`);
  console.log(columns.join('\t'));
  for (const row of rows) {
    const values = row as Record<string, unknown>;
    console.log(columns.map((column) => String(values[column])).join('\t'));
  }
  console.log();
}
