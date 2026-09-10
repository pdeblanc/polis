import { createMidpointKernels } from '../models/birds/midpointKernels';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { PoissonCountProcess, countPoissonRace } from './poissonCountProcess';

const random = createAddressedRandom('poisson-traversal-report-1');
const modes = ['scan', 'cached'] as const;
const samples = 32;
for (const diffusion of [0.5, 4]) for (const n of [4, 32, 1024, 1e6, 1e9]) {
  const p = createMidpointKernels(diffusion)[1].midCell.map((c) => c.probability);
  const run = (mode: typeof modes[number], seed: number) => {
    const paths = p.map((_, i) => new PoissonCountProcess(random, ['birds', seed, String(i)]));
    const stats = { cutoffs: 0 };
    const counts = countPoissonRace(n, paths.map((path, i) => ({ id: String(i), probability: p[i],
      path: { countBefore: (t: number) => path.countBefore(t, mode) } })), stats);
    return { counts, probes: stats.cutoffs,
      visits: paths.reduce((s, path) => s + path.stats.visits, 0),
      nodes: paths.reduce((s, path) => s + path.stats.nodes, 0),
      uniforms: paths.reduce((s, path) => s + path.stats.uniforms, 0) };
  };
  for (let seed = 0; seed < samples; seed++) {
    const a = run('scan', seed);
    const b = run('cached', seed);
    if (a.counts.join(',') !== b.counts.join(',') || a.nodes !== b.nodes || a.uniforms !== b.uniforms || a.probes !== b.probes) {
      throw new Error('Traversal changed the sampled process');
    }
  }
  const results = modes.map((mode) => ({ mode, times: [] as number[], visits: 0, nodes: 0, probes: 0 }));
  for (let round = 0; round < 3; round++) for (const i of round % 2 ? [1, 0] : [0, 1]) {
    const r = results[i];
    const start = performance.now();
    for (let seed = 0; seed < samples; seed++) {
      const draw = run(r.mode, seed);
      r.visits += draw.visits;
      r.nodes += draw.nodes;
      r.probes += draw.probes;
    }
    r.times.push((performance.now() - start) / samples);
  }
  console.log(JSON.stringify({ diffusion, n, categories: p.length, samplesPerRound: samples,
    results: results.map((r) => ({ mode: r.mode, milliseconds: r.times.sort((a, b) => a - b)[1],
      visits: r.visits / (samples * 3), nodes: r.nodes / (samples * 3), probes: r.probes / (samples * 3) })) }));
}
