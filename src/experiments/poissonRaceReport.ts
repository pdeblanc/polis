import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { multinomial } from '../utils/distributions/multinomial';
import { beginDistributionProfile, endDistributionProfile, profileDistribution } from '../utils/distributions/profiling';
import { createMidpointKernels } from '../models/birds/midpointKernels';
import { GammaProcess } from './gammaProcess';
import { directPoissonRace, lazyPoissonRace } from './poissonRace';

const cli = globalThis as unknown as { process?: { argv: string[] } };
const trials = Number(cli.process?.argv[2] ?? 20);
if (!Number.isSafeInteger(trials) || trials < 1 || trials > 200) throw new RangeError('Use 1–200 trials');
const random = createAddressedRandom('poisson-race-report-1');
const cases = [
  { name: 'balanced-3', p: [1 / 3, 1 / 3, 1 / 3] },
  { name: 'skewed-3', p: [0.0001, 0.0099, 0.99] },
  ...[1, 4].map((d) => ({ name: `birds-D${d}`, p: createMidpointKernels(d)[1].midCell.map((v) => v.probability) })),
];

for (const { name, p } of cases) for (const n of [32, 1024, 1e6, 1e9]) {
  const categories = p.map((probability, i) => ({ probability, address: [String(i)] }));
  const run = (seed: number, profile = false, direct = false) => {
    const paths = p.map((_, i) => new GammaProcess(random, [name, seed, String(i)], profile));
    const input = paths.map((path, i) => ({ path, id: String(i), probability: p[i] }));
    const stats = { probes: 0, comparisons: 0, pivots: 0 };
    const counts = (direct ? directPoissonRace : lazyPoissonRace)(n, input, stats);
    if (counts.reduce((a, b) => a + b, 0) !== n) throw new Error('Conservation failure');
    return { paths, stats, counts };
  };
  // Warm both code paths, while every measured race still has fresh paths/caches.
  run(-1);
  multinomial(random, [name, -1], n, categories);
  let start = performance.now();
  for (let seed = 0; seed < trials; seed++) run(seed);
  const lazyUs = (performance.now() - start) * 1000 / trials;
  const baselineTrials = Math.max(trials, 200);
  start = performance.now();
  for (let seed = 0; seed < baselineTrials; seed++) multinomial(random, [name, seed], n, categories);
  const sequentialUs = (performance.now() - start) * 1000 / baselineTrials;
  let directUs: number | undefined;
  if (n <= 1024) {
    start = performance.now();
    for (let seed = 0; seed < trials; seed++) run(seed, false, true);
    directUs = (performance.now() - start) * 1000 / trials;
  }
  // Profile separately: nested scalar/hash times must not be added to the clean timing.
  beginDistributionProfile();
  const detail = profileDistribution('multinomial', () => run(0, true));
  const profile = endDistributionProfile().timings.multinomial;
  const sum = (key: keyof GammaProcess['stats']) => detail.paths.reduce((s, path) => s + path.stats[key], 0);
  const scalarMs = sum('gammaMilliseconds') + sum('betaMilliseconds');
  console.log(JSON.stringify({
    name, n, categories: p.length, trials, lazyUs, sequentialUs, directUs,
    ratio: lazyUs / sequentialUs,
    profileSeed: 0, probes: detail.stats.probes, pivots: detail.stats.pivots,
    gammaDraws: sum('gammaSamples'), betaDraws: sum('betaSamples'), uniforms: sum('uniforms'),
    cacheEntries: detail.paths.reduce((s, path) => s + path.cacheEntries, 0),
    collapsedSplits: sum('collapsedSplits'),
    profileTotalMs: profile.inclusiveMilliseconds,
    gammaInclusiveMs: sum('gammaMilliseconds'), betaInclusiveMs: sum('betaMilliseconds'),
    encodingMs: profile.addressEncodingMilliseconds, hashingMs: profile.hashingMilliseconds,
    otherMs: profile.inclusiveMilliseconds - scalarMs,
  }));
}
