import quantile from '@stdlib/stats-base-dists-binomial-quantile';
import { createMidpointKernels } from '../models/birds/midpointKernels';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { PoissonCountProcess, countPoissonRace } from './poissonCountProcess';
import { createHalfBinomialQuantile, type HalfBinomialQuantile } from './halfBinomial';

const random = createAddressedRandom('poisson-binomial-report-1');
const limits = [0, 16, 64, 256];
const samples = 32;
for (const diffusion of [0.5, 4]) for (const n of [4, 32, 1024, 1e6, 1e9]) {
  const p = createMidpointKernels(diffusion)[1].midCell.map((c) => c.probability);
  const run = (split: HalfBinomialQuantile, seed: number) => countPoissonRace(n,
    p.map((probability, i) => ({ id: String(i), probability,
      path: new PoissonCountProcess(random, ['birds', seed, String(i)], false, 4, split) })));
  const full: HalfBinomialQuantile = (u, count) => quantile(u, count, 0.5);
  for (let i = 0; i < 8; i++) run(full, i);
  const histogram = new Map<number, number>();
  let scalarMs = 0;
  const start = performance.now();
  const reference = Array.from({ length: samples }, (_, seed) => run((u, count) => {
    histogram.set(count, (histogram.get(count) ?? 0) + 1);
    const begin = performance.now();
    const result = full(u, count);
    scalarMs += performance.now() - begin;
    return result;
  }, seed));
  const captureMs = performance.now() - start;
  const candidates = limits.map((limit) => {
    const split = createHalfBinomialQuantile(limit);
    const begin = performance.now();
    for (let seed = 0; seed < samples; seed++) {
      if (run(split, seed).join(',') !== reference[seed].join(',')) throw new Error('Table changed the race');
    }
    return { limit, split, firstPassMs: performance.now() - begin, times: [] as number[] };
  });
  for (let round = 0; round < 3; round++) {
    const order = round % 2 ? [...candidates].reverse() : [...candidates];
    order.push(...order.splice(0, round));
    for (const candidate of order) {
      const begin = performance.now();
      for (let seed = 0; seed < samples; seed++) run(candidate.split, seed);
      candidate.times.push((performance.now() - begin) / samples);
    }
  }
  const total = [...histogram.values()].reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ diffusion, n, categories: p.length, samplesPerRound: samples,
    splitsPerRace: total / samples, profiledScalarMs: scalarMs / samples, captureMs: captureMs / samples,
    candidates: candidates.map((c) => ({ limit: c.limit,
      coveredFraction: total ? [...histogram].reduce((s, [count, calls]) => s + (count <= c.limit ? calls : 0), 0) / total : 0,
      tableBytes: [...histogram.keys()].reduce((s, count) => s + (count <= c.limit ? count * 8 : 0), 0),
      firstPassMs: c.firstPassMs / samples,
      milliseconds: c.times.sort((a, b) => a - b)[1] })),
  }));
}
