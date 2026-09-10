import { BirdsEngine } from '../models/birds/birdsEngine';
import { birdsScale } from '../models/birds/scales';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import type { Address } from '../utils/rng/address';
import { multinomial, withMultinomialObserver, type MultinomialCategory } from '../utils/distributions/multinomial';
import { PoissonCountProcess, countPoissonRace, POISSON_MATERIALIZATION_COUNT } from './poissonCountProcess';

interface Group {
  n: number;
  p: readonly number[];
  calls: number;
  examples: { address: Address; categories: readonly MultinomialCategory[] }[];
}

const cli = globalThis as unknown as { process?: { argv: string[] } };
const samples = Number(cli.process?.argv[2] ?? 64);
const detailed = cli.process?.argv.includes('--details') ?? false;
const cutoffArgument = cli.process?.argv.find((arg) => arg.startsWith('--cutoffs='));
const cutoffs = cutoffArgument ? cutoffArgument.slice('--cutoffs='.length).split(',').map(Number) : [POISSON_MATERIALIZATION_COUNT];
if (!cutoffs.length || cutoffs.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 256)) throw new RangeError('Use cutoffs from 1 to 256');
if (!Number.isSafeInteger(samples) || samples < 8 || samples > 512) throw new RangeError('Use 8–512 samples per parameter group');
const cases = [
  ...[1, 2, 3].map((epoch) => ({ epoch, density: 2, diffusion: 0.5, columns: 80, rows: 50 })),
  { epoch: 2, density: 2, diffusion: 2, columns: 20, rows: 8 },
  { epoch: 2, density: 32, diffusion: 0.5, columns: 20, rows: 8 },
];

for (const c of cases) {
  const label = `e${c.epoch}-D${c.diffusion}-density${c.density}-${c.columns * c.rows}cells`;
  const seed = `Birds engine profile ${c.columns === 80 ? 'viewport-4000' : 'viewport'}-e${c.epoch}-D${c.diffusion}-cold`;
  const scale = birdsScale(c.epoch)!;
  const query = () => {
    const engine = new BirdsEngine(seed, c.density, c.diffusion);
    const start = performance.now();
    for (let t = 0; t < c.rows; t++) for (let x = -c.columns / 2; x < c.columns / 2; x++) {
      engine.queryCell({ min: x * scale.cellLength, max: (x + 1) * scale.cellLength, time: t * scale.nextFlowDuration });
    }
    return performance.now() - start;
  };
  query(); // JIT warmup; each run still starts with a cold model cache.
  const baselineMs = query();
  const groups = new Map<string, Group>();
  withMultinomialObserver((n, categories, address) => {
    const p = categories.map((v) => v.probability);
    const key = JSON.stringify([n, p]);
    let group = groups.get(key);
    if (!group) {
      group = { n, p, calls: 0, examples: [] };
      groups.set(key, group);
    }
    group.calls++;
    if (group.examples.length < 8) group.examples.push({ address, categories });
  }, query);
  const ordered = [...groups.values()].sort((a, b) => a.n - b.n);
  const calls = ordered.reduce((s, g) => s + g.calls, 0);
  const histogram = new Map<number, number>();
  const kernels = new Map<string, number>();
  for (const g of ordered) {
    histogram.set(g.n, (histogram.get(g.n) ?? 0) + g.calls);
    const key = JSON.stringify(g.p);
    kernels.set(key, (kernels.get(key) ?? 0) + g.calls);
  }
  const percentile = (fraction: number, nonzero = false) => {
    const target = fraction * (calls - (nonzero ? histogram.get(0) ?? 0 : 0));
    let accumulated = 0;
    for (const [n, frequency] of histogram) {
      if (nonzero && n === 0) continue;
      accumulated += frequency;
      if (accumulated >= target) return n;
    }
    return 0;
  };
  console.log(JSON.stringify({ kind: 'workload', label, baselineMs, calls, groups: ordered.length,
    zeroFraction: (histogram.get(0) ?? 0) / calls,
    medianNonzero: percentile(0.5, true), p95Nonzero: percentile(0.95, true), maxN: ordered.at(-1)!.n,
    histogram: detailed ? [...histogram] : undefined,
    kernels: [...kernels].map(([p, frequency]) => ({ p: JSON.parse(p), calls: frequency })),
  }));
  const randoms = Array.from({ length: Math.max(samples, 512) }, (_, i) => createAddressedRandom(`workload-replay-${i}`));
  let estimatedSequentialMs = 0;
  const estimatedRaceMs = cutoffs.map(() => 0);
  const rows: object[] = [];
  for (const g of ordered) {
    const sequential = (i: number) => {
      const e = g.examples[i % g.examples.length];
      return multinomial(randoms[i], e.address, g.n, e.categories);
    };
    const race = (i: number, cutoff: number) => {
      const e = g.examples[i % g.examples.length];
      // Deterministic cases need no latent process. Preserve semantic category addresses.
      if (g.n === 0) return g.p.map(() => 0);
      if (g.p.filter((p) => p > 0).length === 1) return g.p.map((p) => p ? g.n : 0);
      return countPoissonRace(g.n, e.categories.map((category, j) => ({
        id: String(j), probability: category.probability,
        path: new PoissonCountProcess(randoms[i], [...e.address, 'race-category', ...category.address], false, cutoff),
      })));
    };
    for (let i = 0; i < 8; i++) { sequential(i); for (const cutoff of cutoffs) race(i, cutoff); }
    const times: { sequential: number; race: number[] }[] = [];
    // Rotate/reverse candidate order between rounds. Every measured race has fresh paths.
    for (let round = 0; round < 3; round++) {
      const measured = { sequential: 0, race: cutoffs.map(() => 0) };
      const modes = [-1, ...cutoffs.map((_, i) => i)];
      if (round % 2) modes.reverse();
      modes.push(...modes.splice(0, round));
      for (const mode of modes) {
        const count = mode >= 0 ? samples : randoms.length;
        const start = performance.now();
        for (let i = 0; i < count; i++) {
          const result = mode >= 0 ? race(i, cutoffs[mode]) : sequential(i);
          if (result.reduce((s, v) => s + v, 0) !== g.n) throw new Error('Replay conservation failure');
        }
        const elapsed = (performance.now() - start) / count;
        if (mode < 0) measured.sequential = elapsed;
        else measured.race[mode] = elapsed;
      }
      times.push(measured);
    }
    const seqMs = times.map((t) => t.sequential).sort((a, b) => a - b)[1];
    estimatedSequentialMs += g.calls * seqMs;
    const raceUs = cutoffs.map((cutoff, i) => {
      const raceMs = times.map((t) => t.race[i]).sort((a, b) => a - b)[1];
      estimatedRaceMs[i] += g.calls * raceMs;
      return { cutoff, microseconds: raceMs * 1000 };
    });
    rows.push({ n: g.n, p: g.p, calls: g.calls, sequentialUs: seqMs * 1000, raceUs });
  }
  console.log(JSON.stringify({ kind: 'replay', label, samplesPerGroup: samples, rows: detailed ? rows : undefined,
    weightedSequentialUs: estimatedSequentialMs * 1000 / calls,
    candidates: cutoffs.map((cutoff, i) => ({ cutoff,
      weightedRaceUs: estimatedRaceMs[i] * 1000 / calls,
      samplerRatio: estimatedRaceMs[i] / estimatedSequentialMs,
      estimatedExtraMs: estimatedRaceMs[i] - estimatedSequentialMs,
      frozenWorkloadModelRatio: 1 + (estimatedRaceMs[i] - estimatedSequentialMs) / baselineMs,
    })),
  }));
}
