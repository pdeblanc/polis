import { createMidpointKernels } from '../models/birds/midpointKernels';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { PoissonCountProcess, countPoissonRace } from './poissonCountProcess';

const random = createAddressedRandom('poisson-cutoff-benchmark-1');
const cutoffs = [1, 2, 4, 8, 16, 32, 64];
const samples = 8;
for (const n of [1024, 1e6, 1e9]) {
  const p = createMidpointKernels(4)[1].midCell.map((c) => c.probability);
  const totals = cutoffs.map(() => ({ milliseconds: [] as number[], binomials: 0, points: 0, nodes: 0, cutoffs: 0 }));
  const run = (cutoff: number, seed: number) => {
    const paths = p.map((_, i) => new PoissonCountProcess(random, ['race', seed, String(i)], false, cutoff));
    const stats = { cutoffs: 0 };
    const counts = countPoissonRace(n, paths.map((path, i) => ({ id: String(i), probability: p[i], path })), stats);
    if (counts.reduce((s, v) => s + v, 0) !== n) throw new Error('Conservation failure');
    return { paths, stats };
  };
  for (const cutoff of cutoffs) run(cutoff, -1);
  for (let round = 0; round < 3; round++) {
    const order = cutoffs.map((_, i) => i);
    if (round % 2) order.reverse();
    order.push(...order.splice(0, round));
    for (const i of order) {
      const start = performance.now();
      for (let seed = 0; seed < samples; seed++) {
        const result = run(cutoffs[i], seed);
        totals[i].cutoffs += result.stats.cutoffs;
        for (const path of result.paths) {
          totals[i].binomials += path.stats.binomialSamples;
          totals[i].points += path.stats.materializedPoints;
          totals[i].nodes += path.stats.nodes;
        }
      }
      totals[i].milliseconds.push((performance.now() - start) / samples);
    }
  }
  console.log(JSON.stringify({ n, categories: p.length, samplesPerRound: samples,
    candidates: totals.map((v, i) => ({
      cutoff: cutoffs[i], milliseconds: v.milliseconds.sort((a, b) => a - b)[1],
      binomials: v.binomials / (samples * 3), points: v.points / (samples * 3),
      nodes: v.nodes / (samples * 3), cutoffs: v.cutoffs / (samples * 3),
    })),
  }));
}
