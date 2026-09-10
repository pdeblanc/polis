import { createMidpointKernels } from '../models/birds/midpointKernels';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { beginDistributionProfile, endDistributionProfile, profileDistribution } from '../utils/distributions/profiling';
import { PoissonCountProcess, countPoissonRace } from './poissonCountProcess';

const random = createAddressedRandom('prefix-profile-1');
// Omitting the optional capability exercises full encoding via the fallback.
const sources = [
  { name: 'full', random: { randomU64: random.randomU64 } },
  { name: 'prefix', random },
];
const p = createMidpointKernels(4)[1].midCell.map((c) => c.probability);
const samples = 16;
for (const layout of ['short', 'long']) for (const n of [4, 1024, 1e6, 1e9]) {
  const run = (source: typeof sources[number], seed: number) => countPoissonRace(n,
    p.map((probability, i) => ({ id: String(i), probability,
      path: new PoissonCountProcess(source.random, layout === 'short' ? [seed, String(i)] :
        ['birds', seed, 'midpoint', 'flow', 16, 32, 0.5, String(i)]),
    })));
  for (let seed = 0; seed < samples; seed++) {
    if (run(sources[0], seed).join(',') !== run(sources[1], seed).join(',')) {
      throw new Error('Prefix encoding changed the race');
    }
  }
  const times = sources.map(() => [] as number[]);
  for (let round = 0; round < 3; round++) for (const i of round % 2 ? [1, 0] : [0, 1]) {
    const start = performance.now();
    for (let seed = 0; seed < samples; seed++) run(sources[i], seed);
    times[i].push((performance.now() - start) / samples);
  }
  const results = sources.map((source, i) => {
    beginDistributionProfile();
    profileDistribution('multinomial', () => {
      for (let seed = 0; seed < samples; seed++) run(source, seed);
    });
    const profile = endDistributionProfile().timings.multinomial;
    return { encoding: source.name, milliseconds: times[i].sort((a, b) => a - b)[1],
      profileMs: profile.inclusiveMilliseconds / samples,
      encodingMs: profile.addressEncodingMilliseconds / samples,
      hashingMs: profile.hashingMilliseconds / samples };
  });
  console.log(JSON.stringify({ layout, n, categories: p.length, samplesPerRound: samples, results }));
}
