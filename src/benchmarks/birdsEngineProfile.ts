import { BirdsEngine } from '../models/birds/birdsEngine';
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
for (const profileCase of cases) {
  // Warm JIT paths separately so the baseline/profile comparison is not determined by
  // which mode happened to execute a query family first.
  runBaseline(profileCase);
  runProfiled(profileCase);
  const baselineMilliseconds = runBaseline(profileCase);
  const { elapsedMilliseconds, profile } = runProfiled(profileCase);
  const label = caseLabel(profileCase);
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
}

writeTable('query-summary', summaries);
writeTable('distribution-detail', details);

function runBaseline(profileCase: ProfileCase): number {
  const { query } = prepare(profileCase);
  if (profileCase.cache === 'warm') query();
  const start = performance.now();
  query();
  return performance.now() - start;
}

function runProfiled(profileCase: ProfileCase): {
  readonly elapsedMilliseconds: number;
  readonly profile: DistributionProfile;
} {
  const { query } = prepare(profileCase);
  if (profileCase.cache === 'warm') query();
  beginDistributionProfile();
  const start = performance.now();
  query();
  const elapsedMilliseconds = performance.now() - start;
  return { elapsedMilliseconds, profile: endDistributionProfile() };
}

function prepare(profileCase: ProfileCase): {
  readonly engine: BirdsEngine;
  readonly query: () => void;
} {
  const scale = birdsScale(profileCase.epoch)!;
  const engine = new BirdsEngine(
    `Birds engine profile ${caseLabel(profileCase)}`,
    2,
    profileCase.diffusionRate,
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
