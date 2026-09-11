import { Birds } from '../models/birds/birds';
import { brownianIntervalTransitionProbability } from '../utils/math/brownian';
import normalCdf from '@stdlib/stats-base-dists-normal-cdf';
import { evaluationPlan, type EvaluationPlan } from './evaluationProtocol';

export function smokeReferenceMoment(c: SmokeCase, tolerance = 1e-10) {
  const sigma = Math.sqrt(c.D * c.T) / c.L;
  if (!sigma) return { secondMoment: 0, tailBound: 0 };
  let moment = 0;
  for (let k = 1; k < 1000; k++) {
    moment += 2 * k * k * brownianIntervalTransitionProbability({ min: 0, max: 1 }, { min: k, max: k + 1 }, c.T / c.L ** 2, c.D);
    // Binned displacement differs from Gaussian displacement by at most one L.
    const a = (k - 1) / sigma;
    const phi = Math.exp(-a * a / 2) / Math.sqrt(2 * Math.PI);
    const tail = normalCdf(-a, 0, 1);
    const bound = 2 * sigma * sigma * (a * phi + tail) + 4 * sigma * phi + 2 * tail;
    if (bound <= tolerance) return { secondMoment: moment, tailBound: bound };
  }
  throw new Error('Reference moment tail did not converge');
}

export const SMOKE_CASES = [4, 1].flatMap((L) => [0.5, 2].map((D) => ({ L, D, mu: 4, rho: 4 / L, T: L * L / 4 })));
export const SMOKE_STRATA = [[0, 0], [1, 1], [-1, -1], [3, -2]] as const;
export type SmokeCase = typeof SMOKE_CASES[number];
export interface Observation {
  id: string; stratum: number; kind: 'population' | 'union' | 'half' | 'outflows' | 'inflows';
  min: number; max: number; time: number; j: number; h: number; reflected: boolean;
}
export interface Sample {
  request: Observation;
  status: 'ok' | 'unsupported' | 'size-limit' | 'error';
  result?: unknown; count?: number;
  flows?: { count: number; source: { min: number; max: number; time: number }; destination: { min: number; max: number; time: number } }[];
  detail?: string; elapsedMs: number;
}
export interface SmokeTrial {
  caseIndex: number; trial: number; seed: string; status: 'complete'; observations: Sample[];
  consistency: { checked: number; failures: string[] }; replayFailures: string[];
  cache: ReturnType<Birds['getCacheUsage']>;
}

export function smokeObservations(c: SmokeCase, strata: EvaluationPlan['strata'] = SMOKE_STRATA): Observation[] {
  const rows: Observation[] = [];
  for (const [s, [a, b]] of strata.entries()) {
    const add = (kind: Observation['kind'], j: number, h: number, min: number, max: number, reflected = false) => {
      rows.push({ id: `${s}:${kind}:${j}:${h}:${reflected}`, stratum: s, kind, j, h, min, max,
        time: (b + h) * c.T, reflected });
    };
    for (const h of [0, 1, 2, 4]) {
      for (let j = -8; j <= 8; j++) add('population', j, h, (a + j) * c.L, (a + j + 1) * c.L);
      add('union', 0, h, (a - 8) * c.L, (a + 9) * c.L);
      add('population', 0, h, -(a + 1) * c.L, -a * c.L, true);
    }
    for (const j of [0, 1]) add('half', j, 0, (a + j / 2) * c.L, (a + (j + 1) / 2) * c.L);
    add('outflows', 0, 0, a * c.L, (a + 1) * c.L);
    add('inflows', 0, 1, a * c.L, (a + 1) * c.L);
    add('outflows', 0, 0, -(a + 1) * c.L, -a * c.L, true);
  }
  return rows;
}

export function observe(birds: Birds, c: SmokeCase, request: Observation): Sample {
  const start = performance.now();
  const finish = (sample: Omit<Sample, 'request' | 'elapsedMs'>): Sample => ({ request, ...sample, elapsedMs: performance.now() - start });
  try {
    if (request.kind === 'outflows' || request.kind === 'inflows') {
      const resolution = birds.resolveFlowResolution({ targetSourceWidth: c.L, targetDestinationWidth: c.L, targetDuration: c.T });
      if (!resolution || resolution.sourceCellWidth !== c.L || resolution.destinationCellWidth !== c.L || resolution.duration !== c.T) {
        return finish({ status: 'unsupported', detail: 'Exact flow resolution unavailable', result: resolution });
      }
      const cell = { min: request.min, max: request.max, time: request.time };
      const result = request.kind === 'outflows' ? birds.queryOutflows({ source: cell, resolution }) : birds.queryInflows({ destination: cell, resolution });
      if (result.kind !== 'flows') return finish({ status: 'size-limit', result });
      const flows = [...result.flows].sort((a, b) => a.source.min - b.source.min || a.destination.min - b.destination.min);
      return finish({ status: 'ok', result: { ...result, flows }, flows, count: flows.reduce((s, f) => s + f.count, 0) });
    }
    const width = request.kind === 'half' ? c.L / 2 : c.L;
    const resolution = birds.resolvePopulationResolution({ targetCellWidth: width, targetTimeStep: c.T });
    if (!resolution || resolution.cellWidth !== width) return finish({ status: 'unsupported', detail: 'Exact population width unavailable', result: resolution });
    const result = birds.queryPopulation({ min: request.min, max: request.max, time: request.time, resolution });
    if (result.sampledTime !== request.time) return finish({ status: 'unsupported', detail: 'Population time snapped', result });
    if (result.kind !== 'population-profile') return finish({ status: 'size-limit', result });
    if (result.samples[0]?.interval.min !== request.min || result.samples.at(-1)?.interval.max !== request.max) {
      return finish({ status: 'unsupported', detail: 'Population interval expanded', result });
    }
    return finish({ status: 'ok', result, count: result.samples.reduce((s, v) => s + v.count, 0) });
  } catch (error) {
    return finish({ status: 'error', detail: error instanceof Error ? error.message : String(error) });
  }
}

export function runSmokeTrial(caseIndex: number, trial: number, notify: (id: string | null) => void = () => {},
  plan: EvaluationPlan = evaluationPlan('smoke')): SmokeTrial {
  const c = plan.cases[caseIndex];
  const seed = `Polis evaluation protocol 1 trial ${trial}`;
  const make = () => new Birds(seed, c.rho, c.D);
  const requests = smokeObservations(c, plan.strata);
  const run = (model: Birds, request: Observation) => {
    notify(request.id);
    try { return observe(model, c, request); } finally { notify(null); }
  };
  const model = make();
  const observations = requests.map((r) => run(model, r));
  const cache = model.getCacheUsage();
  const replayFailures: string[] = [];
  if (trial < 32) {
    const expected = new Map(observations.map((s) => [s.request.id, JSON.stringify({ ...s, elapsedMs: 0 })]));
    const replay = make();
    for (const request of [...requests].reverse()) {
      if (JSON.stringify({ ...run(replay, request), elapsedMs: 0 }) !== expected.get(request.id)) replayFailures.push(`reverse:${request.id}`);
    }
    replay.clearCache();
    for (const request of requests) {
      if (JSON.stringify({ ...run(replay, request), elapsedMs: 0 }) !== expected.get(request.id)) replayFailures.push(`clear:${request.id}`);
    }
  }
  const consistency = { checked: 0, failures: [] as string[] };
  const check = (name: string, parts: Sample[], target?: Sample) => {
    if (!target || target.status !== 'ok' || parts.some((p) => p.status !== 'ok')) return;
    consistency.checked++;
    if (parts.reduce((sum, p) => sum + p.count!, 0) !== target.count) consistency.failures.push(name);
  };
  for (const sample of observations) if (sample.status === 'ok') {
    const counts = sample.flows?.map((f) => f.count) ?? [sample.count!];
    for (const n of counts) {
      consistency.checked++;
      if (!Number.isSafeInteger(n) || n < 0) consistency.failures.push(`count:${sample.request.id}`);
    }
  }
  for (let s = 0; s < plan.strata.length; s++) {
    const rows = observations.filter((v) => v.request.stratum === s && !v.request.reflected);
    for (const h of [0, 1, 2, 4]) check(`union:${s}:${h}`, rows.filter((v) => v.request.kind === 'population' && v.request.h === h),
      rows.find((v) => v.request.kind === 'union' && v.request.h === h));
    const center = (h: number) => rows.find((v) => v.request.kind === 'population' && v.request.j === 0 && v.request.h === h);
    check(`halves:${s}`, rows.filter((v) => v.request.kind === 'half'), center(0));
    for (const kind of ['outflows', 'inflows'] as const) check(`${kind}:${s}`, rows.filter((v) => v.request.kind === kind), center(kind === 'outflows' ? 0 : 1));
  }
  return { caseIndex, trial, seed, status: 'complete', observations, consistency, replayFailures, cache };
}

export function poissonReferenceBins(target: number) {
  // Start at the mode: exp(-target) underflows for the largest union means.
  const mode = Math.floor(target);
  let logFactorial = 0;
  for (let k = 2; k <= mode; k++) logFactorial += Math.log(k);
  const probabilities = Array<number>(mode + 1).fill(0);
  probabilities[mode] = target === 0 ? 1 : Math.exp(-target + mode * Math.log(target) - logFactorial);
  for (let k = mode; k > 0; k--) probabilities[k - 1] = probabilities[k] * k / target;
  let pmf = probabilities[mode], covered = probabilities.reduce((a, b) => a + b, 0);
  while (1 - covered > 1e-10) {
    pmf *= target / probabilities.length;
    probabilities.push(pmf); covered += pmf;
    if (probabilities.length > 10000) throw new Error('Poisson reference did not converge');
  }
  probabilities.push(Math.max(0, 1 - covered));
  return probabilities;
}

export function countStatistics(values: number[], target: number) {
  const n = values.length;
  if (!n) return { samples: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : null;
  const probabilities = poissonReferenceBins(target);
  const histogram = probabilities.map(() => 0);
  for (const v of values) histogram[Math.min(v, histogram.length - 1)]++;
  return { samples: n, mean, variance, meanError: mean - target, varianceToMean: mean && variance !== null ? variance / mean : null,
    zeroFrequency: values.filter((v) => v === 0).length / n, targetMean: target,
    poissonZeroProbability: Math.exp(-target), K: probabilities.length - 2,
    tv: probabilities.reduce((s, p, i) => s + Math.abs(histogram[i] / n - p), 0) / 2 };
}

export function summarizeSmoke(caseIndex: number, trials: SmokeTrial[], plan: EvaluationPlan = evaluationPlan('smoke')) {
  const c = plan.cases[caseIndex];
  const groups = smokeObservations(c, plan.strata);
  const marginals = groups.filter((r) => r.kind === 'population').map((r) => ({ id: r.id,
    ...countStatistics(trials.flatMap((t) => { const v = t.observations.find((v) => v.request.id === r.id); return v?.status === 'ok' ? [v.count!] : []; }), c.mu) }));
  const flows = groups.filter((r) => r.kind === 'outflows').map((r) => {
    const lists = trials.flatMap((t) => { const v = t.observations.find((v) => v.request.id === r.id); return v?.status === 'ok' ? [v] : []; });
    const probability = (j: number) => brownianIntervalTransitionProbability({ min: 0, max: c.L }, { min: j * c.L, max: (j + 1) * c.L }, c.T, c.D);
    const inside = Array.from({ length: 17 }, (_, i) => probability(i - 8));
    const bins = [...Array.from({ length: 17 }, (_, i) => i - 8), 'tail' as const].map((j, i) => ({ j,
      ...countStatistics(lists.map((v) => v.flows!.reduce((s, f) => {
        const offset = (f.destination.min - r.min) / c.L;
        return s + ((j === 'tail' ? Math.abs(offset) > 8 : offset === j) ? f.count : 0);
      }, 0)), c.mu * (j === 'tail' ? Math.max(0, 1 - inside.reduce((a, b) => a + b, 0)) : inside[i])) }));
    let birds = 0, first = 0, second = 0;
    for (const v of lists) for (const f of v.flows!) { const dx = (f.destination.min - r.min) / c.L; birds += f.count; first += f.count * dx; second += f.count * dx * dx; }
    return { id: r.id, bins, birds, mean: birds ? first / birds : null, secondMoment: birds ? second / birds : null,
      variance: birds ? second / birds - (first / birds) ** 2 : null };
  });
  const covariances = plan.strata.flatMap((_, s) => [0, 1, 2, 4, 8].flatMap((j) => [0, 1, 2, 4].map((h) => {
    const pairs = trials.flatMap((t) => {
      const a = t.observations.find((v) => v.request.id === `${s}:population:0:0:false`);
      const b = t.observations.find((v) => v.request.id === `${s}:population:${j}:${h}:false`);
      return a?.status === 'ok' && b?.status === 'ok' ? [[a.count!, b.count!]] : [];
    });
    const n = pairs.length;
    const ma = pairs.reduce((v, p) => v + p[0], 0) / n, mb = pairs.reduce((v, p) => v + p[1], 0) / n;
    return { stratum: s, j, h, samples: n, covariance: n > 1 ? pairs.reduce((v, p) => v + (p[0] - ma) * (p[1] - mb), 0) / (n - 1) : null,
      reference: c.mu * brownianIntervalTransitionProbability({ min: 0, max: c.L }, { min: j * c.L, max: (j + 1) * c.L }, h * c.T, c.D) };
  })));
  const referenceMoment = smokeReferenceMoment(c);
  const tightened = smokeReferenceMoment(c, 1e-12);
  const referenceConverged = Math.abs(referenceMoment.secondMoment - tightened.secondMoment) < 1e-8;
  const meanErrors = marginals.filter((m) => 'meanError' in m && m.meanError !== undefined);
  const observedMse = meanErrors.reduce((s, m) => s + m.meanError! ** 2, 0) / meanErrors.length;
  const correctedMse = meanErrors.reduce((s, m) => s + m.meanError! ** 2 - (m.variance ?? 0) / m.samples, 0) / meanErrors.length;
  return { caseIndex, ...c, completedTrials: trials.length, expectedTrials: plan.trialsPerCase, marginals, flows, covariances,
    meanErrorSummary: { observations: meanErrors.length, rms: Math.sqrt(observedMse), correctedMse,
      correctedRms: Math.sqrt(Math.max(0, correctedMse)) },
    flowReference: { mean: 0, ...referenceMoment, referenceConverged },
    statuses: trials.flatMap((t) => t.observations).reduce((s, o) => { s[o.status] = (s[o.status] ?? 0) + 1; return s; }, {} as Record<string, number>),
    consistencyFailures: trials.flatMap((t) => t.consistency.failures), replayFailures: trials.flatMap((t) => t.replayFailures) };
}
