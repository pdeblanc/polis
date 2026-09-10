import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { multinomial } from '../utils/distributions/multinomial';
import { beginDistributionProfile, endDistributionProfile, profileDistribution } from '../utils/distributions/profiling';
import { createMidpointKernels } from '../models/birds/midpointKernels';
import { POISSON_MATERIALIZATION_COUNT, PoissonCountProcess, countPoissonRace } from './poissonCountProcess';
import { GammaProcess } from './gammaProcess';
import { lazyPoissonRace } from './poissonRace';

const cli = globalThis as unknown as { process?: { argv: string[] } };
const trials = Number(cli.process?.argv[2] ?? 20);
if (!Number.isSafeInteger(trials) || trials < 1 || trials > 200) throw new RangeError('Use 1–200 trials');
const random = createAddressedRandom('poisson-count-race-report-1');
const cases = [
  { name: 'balanced-3', p: [1 / 3, 1 / 3, 1 / 3] },
  { name: 'skewed-3', p: [0.0001, 0.0099, 0.99] },
  ...[1, 4].map((d) => ({ name: `birds-D${d}`, p: createMidpointKernels(d)[1].midCell.map((v) => v.probability) })),
];

for (const { name, p } of cases) for (const n of [32, 1024, 1e6, 1e9]) {
  const categories = p.map((probability, i) => ({ probability, address: [String(i)] }));
  const run = (seed: number, profile = false) => {
    const paths = p.map((_, i) => new PoissonCountProcess(random, [name, seed, String(i)], profile));
    const stats = { cutoffs: 0 };
    const counts = countPoissonRace(n, paths.map((path, i) => ({ path, id: String(i), probability: p[i] })), stats);
    if (counts.reduce((a, b) => a + b, 0) !== n) throw new Error('Conservation failure');
    return { paths, stats, counts };
  };
  run(-1);
  multinomial(random, [name, -1], n, categories);
  let start = performance.now();
  let cutoffs = 0;
  for (let seed = 0; seed < trials; seed++) cutoffs += run(seed).stats.cutoffs;
  const countRaceUs = (performance.now() - start) * 1000 / trials;
  const baselineTrials = Math.max(trials, 200);
  start = performance.now();
  for (let seed = 0; seed < baselineTrials; seed++) multinomial(random, [name, seed], n, categories);
  const sequentialUs = (performance.now() - start) * 1000 / baselineTrials;
  const gammaRun = (seed: number) => lazyPoissonRace(n, p.map((probability, i) => ({
    id: String(i), probability, path: new GammaProcess(random, [name, seed, String(i)]),
  })));
  gammaRun(-1);
  const gammaTrials = Math.min(trials, 3);
  start = performance.now();
  for (let seed = 0; seed < gammaTrials; seed++) gammaRun(seed);
  const gammaBridgeUs = (performance.now() - start) * 1000 / gammaTrials;
  beginDistributionProfile();
  const detail = profileDistribution('multinomial', () => run(0, true));
  const profile = endDistributionProfile().timings.multinomial;
  const sum = (key: keyof PoissonCountProcess['stats']) => detail.paths.reduce((s, path) => s + path.stats[key], 0);
  console.log(JSON.stringify({
    name, n, categories: p.length, trials, materializationCount: POISSON_MATERIALIZATION_COUNT,
    countRaceUs, sequentialUs, gammaTrials, gammaBridgeUs,
    ratio: countRaceUs / sequentialUs, averageCutoffs: cutoffs / trials,
    profileSeed: 0, nodes: sum('nodes'), visits: sum('visits'),
    poissonDraws: sum('poissonSamples'), binomialDraws: sum('binomialSamples'),
    uniforms: sum('uniforms'), materializedPoints: sum('materializedPoints'),
    profileTotalMs: profile.inclusiveMilliseconds,
    poissonInclusiveMs: sum('poissonMilliseconds'), binomialInclusiveMs: sum('binomialMilliseconds'),
    encodingMs: profile.addressEncodingMilliseconds, hashingMs: profile.hashingMilliseconds,
    otherMs: profile.inclusiveMilliseconds - sum('poissonMilliseconds') - sum('binomialMilliseconds'),
  }));
}
