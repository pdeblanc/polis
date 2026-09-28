import { Birds2aEngine } from '../models/birds2a/birds2aEngine';
import { birds2aDependencyBounds, birds2aDependencyRank, type Birds2aDependencyNode,
  type Birds2aQueryNode } from '../models/birds2a/dependencyRanks';

export interface Birds2aComplexityCase {
  readonly id: string;
  readonly family: 'expansion' | 'cell' | 'flow' | 'viewport' | 'time-offset';
  readonly scale: number;
  readonly density: number;
  readonly diffusion: number;
  readonly seed: string;
  readonly queries: readonly Birds2aQueryNode[];
}
export const BIRDS_2A_BENCHMARK_SEED = 'Polis Birds 2a complexity 1';

export function birds2aComplexityCase(
  family: Birds2aComplexityCase['family'], scale: number, density = 32, diffusion = 0.5,
): Birds2aComplexityCase {
  const width = family === 'time-offset' ? 1 : 2 ** (family === 'expansion' ? scale : -scale);
  const step = width ** 2 / 4;
  const start = family === 'time-offset' ? scale + 0.25 : Math.floor(0.375 / step) * step;
  const cell = (index: number, time: number) => ({ min: index * width, max: (index + 1) * width, time });
  let queries: Birds2aQueryNode[];
  switch (family) {
    case 'expansion': queries = [{ role: 'flow', flow: { source: cell(0, 0), destination: cell(0, width ** 2) } }]; break;
    case 'cell':
    case 'time-offset': queries = [{ role: 'cell', cell: cell(0, start) }]; break;
    case 'flow': queries = [{ role: 'flow', flow: { source: cell(0, start), destination: cell(1, start + step) } }]; break;
    case 'viewport': queries = Array.from({ length: 24 }, (_, i) => ({ role: 'cell',
      cell: cell(i % 6 - 2, start + Math.floor(i / 6) * step) })); break;
  }
  return { id: `${family}-s${scale}-rho${density}-D${diffusion}`, family, scale, density, diffusion,
    seed: BIRDS_2A_BENCHMARK_SEED, queries };
}

export function birds2aComplexityCases(sweep = false): Birds2aComplexityCase[] {
  const result = [0, 2, 4].map((scale) => birds2aComplexityCase('expansion', scale));
  result.push(...(sweep ? [-256, -16, 0, 16, 256] : [-16, 1, 16])
    .map((offset) => birds2aComplexityCase('time-offset', offset)));
  if (sweep) {
    for (const density of [1, 32, 128]) for (const diffusion of [0, 0.5, 2])
      for (const scale of [0, 1, 2, 4]) for (const family of ['cell', 'flow', 'viewport'] as const)
        result.push(birds2aComplexityCase(family, scale, density, diffusion));
  } else {
    for (const family of ['cell', 'flow'] as const) for (const scale of [0, 2, 4])
      result.push(birds2aComplexityCase(family, scale));
    result.push(birds2aComplexityCase('viewport', 1));
    for (const diffusion of [0, 2]) result.push(birds2aComplexityCase('viewport', 1, 32, diffusion));
    for (const density of [1, 128]) result.push(birds2aComplexityCase('viewport', 1, density));
  }
  return result;
}

export class Birds2aRequestLimit extends Error {}

/** Observer counts are request counts (including hits), not cache misses or unique
 * evaluations. Timings come from a separate engine with no observer attached. */
export function measureBirds2aComplexity(spec: Birds2aComplexityCase, maxRequests = 250_000, warmRepeats = 5) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || !Number.isSafeInteger(warmRepeats) || warmRepeats < 1) {
    throw new RangeError('Benchmark limits must be positive safe integers');
  }
  const origin = { min: 0, max: 1 };
  const counts = () => ({ requests: 0, nodes: new Set<string>(), byRole: {} as Record<string, number> });
  let current = counts();
  const record = (node: Birds2aDependencyNode) => {
    if (++current.requests > maxRequests) throw new Birds2aRequestLimit(`Exceeded ${maxRequests} requests in one phase`);
    current.nodes.add(JSON.stringify(node));
    current.byRole[node.role] = (current.byRole[node.role] ?? 0) + 1;
  };
  const startDiagnostic = performance.now();
  const diagnostic = new Birds2aEngine(spec.seed, spec.density, spec.diffusion, origin, ({ dependency }) => record(dependency));
  const execute = (engine: Birds2aEngine, observe = false) => spec.queries.map((query) => {
    if (observe) record(query);
    return query.role === 'cell' ? engine.queryCell(query.cell) : engine.queryFlow(query.flow);
  });
  const expected = execute(diagnostic, true);
  const cold = current;
  current = counts();
  const verify = (values: readonly number[]) => {
    if (values.some((value, index) => value !== expected[index]) || values.length !== expected.length) {
      throw new Error('Benchmark replay changed query answers');
    }
  };
  verify(execute(diagnostic, true));
  const warm = current, diagnosticMs = performance.now() - startDiagnostic;
  const expansionEpochs = diagnostic.expansion.retainedEpochCount;
  const setupStart = performance.now();
  const engine = new Birds2aEngine(spec.seed, spec.density, spec.diffusion, origin);
  const setupMs = performance.now() - setupStart;
  const expansionStart = performance.now();
  engine.expansion.getEpoch(expansionEpochs - 1);
  const expansionMs = performance.now() - expansionStart;
  const population = engine.expansion.getEpoch(0).population;
  const coldStart = performance.now();
  const values = execute(engine);
  const coldMs = performance.now() - coldStart;
  verify(values);
  if (engine.expansion.retainedEpochCount !== expansionEpochs) throw new Error('Cold contraction unexpectedly expanded the model');
  const warmTimes = [];
  for (let i = 0; i < warmRepeats; i++) {
    const start = performance.now();
    const values = execute(engine);
    warmTimes.push(performance.now() - start);
    verify(values);
  }
  return { ...spec, population, queryCount: spec.queries.length, expansionEpochs,
    rootRankMax: Math.max(...spec.queries.map((query) => birds2aDependencyRank(query, origin, birds2aDependencyBounds(query, origin))!)),
    setupMs, expansionMs, coldMs, warmMeanMs: warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length,
    warmRepeats, diagnosticMs, coldRequests: cold.requests, coldUniqueNodes: cold.nodes.size,
    warmRequests: warm.requests, warmUniqueNodes: warm.nodes.size, coldByRole: cold.byRole, warmByRole: warm.byRole,
    values };
}
