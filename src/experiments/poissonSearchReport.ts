import { createMidpointKernels } from '../models/birds/midpointKernels';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { POISSON_MATERIALIZATION_COUNT, PoissonCountProcess, countPoissonRace } from './poissonCountProcess';

const random = createAddressedRandom('poisson-search-benchmark-1');
const searches = ['bisection', 'count-guided'] as const;
const samples = 16;
const cases = [
  { name: 'balanced-3', p: [1 / 3, 1 / 3, 1 / 3] },
  { name: 'skewed-3', p: [0.0001, 0.0099, 0.99] },
  ...[0.5, 4].map((d) => ({ name: `birds-D${d}`,
    p: createMidpointKernels(d)[1].midCell.map((c) => c.probability) })),
];
for (const { name, p } of cases) for (const n of [1, 4, 32, 1024, 1e6, 1e9]) {
  const run = (search: typeof searches[number], seed: number) => {
    const paths = p.map((_, i) => new PoissonCountProcess(random, [name, seed, String(i)]));
    const stats = { cutoffs: 0 };
    const counts = countPoissonRace(n, paths.map((path, i) => ({ id: String(i), probability: p[i], path })), stats, search);
    return { counts, probes: stats.cutoffs,
      nodes: paths.reduce((s, path) => s + path.stats.nodes, 0),
      binomials: paths.reduce((s, path) => s + path.stats.binomialSamples, 0) };
  };
  // Check equivalence separately, without reusing warmed process caches in timings.
  for (let seed = 0; seed < samples; seed++) {
    if (run('bisection', seed).counts.join(',') !== run('count-guided', seed).counts.join(',')) {
      throw new Error('Search strategies disagree');
    }
  }
  const results = searches.map((search) => ({ search, times: [] as number[], probes: 0, nodes: 0, binomials: 0 }));
  for (let round = 0; round < 3; round++) for (const i of round % 2 ? [1, 0] : [0, 1]) {
    const result = results[i];
    const start = performance.now();
    for (let seed = 0; seed < samples; seed++) {
      const draw = run(result.search, seed);
      result.probes += draw.probes;
      result.nodes += draw.nodes;
      result.binomials += draw.binomials;
    }
    result.times.push((performance.now() - start) / samples);
  }
  console.log(JSON.stringify({ name, n, categories: p.length, samplesPerRound: samples,
    materializationCount: POISSON_MATERIALIZATION_COUNT,
    results: results.map((r) => ({ search: r.search, milliseconds: r.times.sort((a, b) => a - b)[1],
      probes: r.probes / (samples * 3), nodes: r.nodes / (samples * 3), binomials: r.binomials / (samples * 3) })),
  }));
}
