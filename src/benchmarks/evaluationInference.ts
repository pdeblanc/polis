import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { createAddressedRandom, prefixRandom } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';
import { brownianIntervalTransitionProbability } from '../utils/math/brownian';
import { poissonReferenceBins, smokeObservations, type SmokeTrial } from './evaluationSmoke';
import type { EvaluationPlan } from './evaluationProtocol';

export const INFERENCE_REPLICATES = 2000;
type Metrics = Record<string, number | null>;
export function nearestRank(values: readonly number[], probability: number): number {
  if (!values.length) throw new Error('Empty percentile sample');
  return [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(probability * values.length) - 1)];
}
export function percentileInterval(values: readonly (number | null)[]) {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const undefinedReplicates = values.length - finite.length;
  return { interval: undefinedReplicates || !finite.length ? null : [nearestRank(finite, 0.025), nearestRank(finite, 0.975)], undefinedReplicates };
}

/** The same seed indices are used for every observable, preserving within-seed dependence. */
export function bootstrapIndices(caseIndex: number, replicate: number, count: number): number[] {
  const random = prefixRandom(createAddressedRandom('Polis evaluation protocol 1 bootstrap'), ['A', caseIndex, replicate, -1]);
  return Array.from({ length: count }, (_, draw) => Math.floor(uniformUnit(random, [draw]) * count));
}

function histogramTv(histogram: readonly number[], count: number, probabilities: readonly number[]) {
  return probabilities.reduce((sum, p, i) => sum + Math.abs(histogram[i] / count - p), 0) / 2;
}

/** Unclamped stdlib Poisson draws, deliberately not the model's approximate sampler. */
export function calibratePoissonTv(caseIndex: number, stratum: number, observableId: string,
  target: number, count: number, replicates = INFERENCE_REPLICATES) {
  const probabilities = poissonReferenceBins(target);
  const values: number[] = [];
  if (count) {
    const random = prefixRandom(createAddressedRandom('Polis evaluation protocol 1 TV reference'), ['A', caseIndex, stratum, observableId]);
    for (let replicate = 0; replicate < replicates; replicate++) {
      const histogram = probabilities.map(() => 0);
      for (let trial = 0; trial < count; trial++) {
        const x = target === 0 ? 0 : poissonQuantile(uniformUnit(random, [replicate, trial]), target);
        histogram[Math.min(x, histogram.length - 1)]++;
      }
      values.push(histogramTv(histogram, count, probabilities));
    }
  }
  return { samples: count, replicates, K: probabilities.length - 2,
    median: values.length ? nearestRank(values, 0.5) : null,
    p95: values.length ? nearestRank(values, 0.95) : null };
}

export function countMetrics(values: readonly (number | undefined)[], indices: readonly number[], target: number,
  probabilities = poissonReferenceBins(target)): Metrics {
  const selected = indices.flatMap((i) => values[i] === undefined ? [] : [values[i]!]);
  const n = selected.length;
  if (!n) return { samples: 0, mean: null, variance: null, meanError: null, varianceToMean: null, zeroFrequency: null, tv: null };
  const mean = selected.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? selected.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : null;
  const histogram = probabilities.map(() => 0);
  for (const x of selected) histogram[Math.min(x, histogram.length - 1)]++;
  return { samples: n, mean, variance, meanError: mean - target, varianceToMean: mean && variance !== null ? variance / mean : null,
    zeroFrequency: selected.filter((x) => x === 0).length / n, tv: histogramTv(histogram, n, probabilities) };
}

interface Observable {
  id: string;
  evaluate: (indices: readonly number[]) => Metrics;
  population?: boolean;
  reference?: number;
  calibration?: { stratum: number; observableId: string; target: number };
}

/** Post-processes saved results only; never queries a model. Undefined observations stay missing. */
export function analyzeEvaluationCase(caseIndex: number, trials: SmokeTrial[], plan: EvaluationPlan,
  replicates = INFERENCE_REPLICATES, progress: (message: string) => void = () => {}) {
  if (!Number.isSafeInteger(replicates) || replicates < 1) throw new Error('Invalid replicate count');
  const c = plan.cases[caseIndex];
  const sorted = [...trials].sort((a, b) => a.trial - b.trial);
  if (sorted.some((t, i) => t.caseIndex !== caseIndex || (i > 0 && t.trial === sorted[i - 1].trial))) throw new Error('Mismatched or duplicate trials');
  const rows = sorted.map((t) => new Map(t.observations.map((o) => [o.request.id, o])));
  const indices = rows.map((_, i) => i);
  const observables: Observable[] = [];
  const addCounts = (id: string, values: (number | undefined)[], target: number,
    stratum: number, observableId: string, population = false) => {
    const probabilities = poissonReferenceBins(target);
    observables.push({ id, population, calibration: { stratum, observableId, target },
      evaluate: (sample) => countMetrics(values, sample, target, probabilities) });
  };
  for (const r of smokeObservations(c, plan.strata)) {
    const samples = rows.map((row) => { const o = row.get(r.id); return o?.status === 'ok' ? o : undefined; });
    // Reflected observations use their actual offset from the stratum's origin.
    const a = plan.strata[r.stratum][0];
    if (r.kind === 'population') addCounts(r.id, samples.map((o) => o?.count), c.mu,
      r.stratum, JSON.stringify(['population', r.min / c.L - a, r.h]), true);
    if (r.kind !== 'outflows') continue;
    const probabilities = Array.from({ length: 17 }, (_, i) => brownianIntervalTransitionProbability(
      { min: 0, max: c.L }, { min: (i - 8) * c.L, max: (i - 7) * c.L }, c.T, c.D));
    for (const j of [...Array.from({ length: 17 }, (_, i) => i - 8), 'tail' as const]) {
      const target = c.mu * (j === 'tail' ? Math.max(0, 1 - probabilities.reduce((a, b) => a + b, 0)) : probabilities[j + 8]);
      const values = samples.map((o) => o?.flows?.reduce((sum, f) => {
        const dx = (f.destination.min - r.min) / c.L;
        return sum + ((j === 'tail' ? Math.abs(dx) > 8 : dx === j) ? f.count : 0);
      }, 0));
      // Both reflection checks have the same relative flow law and calibration.
      addCounts(`${r.id}:bin:${j}`, values, target, r.stratum, JSON.stringify(['flow', j, 1]));
    }
    const moments = samples.map((o) => o?.flows?.reduce((m, f) => {
      const dx = (f.destination.min - r.min) / c.L;
      return [m[0] + f.count, m[1] + f.count * dx, m[2] + f.count * dx * dx];
    }, [0, 0, 0]));
    observables.push({ id: `${r.id}:moments`, evaluate: (sample) => {
      let birds = 0, first = 0, second = 0, count = 0;
      for (const i of sample) { const m = moments[i]; if (m) { count++; birds += m[0]; first += m[1]; second += m[2]; } }
      const mean = birds ? first / birds : null, secondMoment = birds ? second / birds : null;
      return { samples: count, birds, mean, secondMoment, variance: mean !== null && secondMoment !== null ? secondMoment - mean ** 2 : null };
    } });
  }
  for (let s = 0; s < plan.strata.length; s++) for (const j of [0, 1, 2, 4, 8]) for (const h of [0, 1, 2, 4]) {
    const pairs = rows.map((row) => {
      const a = row.get(`${s}:population:0:0:false`), b = row.get(`${s}:population:${j}:${h}:false`);
      return a?.status === 'ok' && b?.status === 'ok' ? [a.count!, b.count!] : undefined;
    });
    observables.push({ id: `covariance:${s}:${j}:${h}`, reference: c.mu * brownianIntervalTransitionProbability(
      { min: 0, max: c.L }, { min: j * c.L, max: (j + 1) * c.L }, h * c.T, c.D), evaluate: (sample) => {
      const p = sample.flatMap((i) => pairs[i] ? [pairs[i]!] : []);
      const ma = p.reduce((s, x) => s + x[0], 0) / p.length, mb = p.reduce((s, x) => s + x[1], 0) / p.length;
      return { samples: p.length, covariance: p.length > 1 ? p.reduce((s, x) => s + (x[0] - ma) * (x[1] - mb), 0) / (p.length - 1) : null };
    } });
  }
  const bootstrap = Array.from({ length: replicates }, (_, r) => bootstrapIndices(caseIndex, r, rows.length));
  const mse = Array<number>(replicates).fill(0), corrected = [...mse], missing = Array<boolean>(replicates).fill(false), missingVariance = [...missing];
  let populationCount = 0, pointMse = 0, pointCorrected = 0, pointMissing = false, pointMissingVariance = false;
  const calibrationCache = new Map<string, ReturnType<typeof calibratePoissonTv>>();
  const results = observables.map((observable, ordinal) => {
    const point = observable.evaluate(indices);
    const draws: Record<string, (number | null)[]> = {};
    if (observable.population) {
      populationCount++;
      pointMissing ||= point.meanError === null;
      pointMissingVariance ||= point.variance === null;
      pointMse += (point.meanError ?? 0) ** 2;
      pointCorrected += (point.meanError ?? 0) ** 2 - (point.variance ?? 0) / (point.samples || 1);
    }
    for (let r = 0; r < replicates; r++) {
      const value = observable.evaluate(bootstrap[r]);
      for (const [key, v] of Object.entries(value)) (draws[key] ??= []).push(v);
      if (observable.population) {
        mse[r] += (value.meanError ?? 0) ** 2;
        corrected[r] += (value.meanError ?? 0) ** 2 - (value.variance ?? 0) / (value.samples || 1);
        missing[r] ||= value.meanError === null;
        missingVariance[r] ||= value.variance === null;
      }
    }
    let tvReference;
    if (observable.calibration) {
      const { stratum, observableId, target } = observable.calibration;
      const key = JSON.stringify([stratum, observableId, target, point.samples]);
      tvReference = calibrationCache.get(key);
      if (!tvReference) {
        tvReference = calibratePoissonTv(caseIndex, stratum, observableId, target, point.samples!, replicates);
        calibrationCache.set(key, tvReference);
      }
    }
    progress(`Observable ${ordinal + 1}/${observables.length}`);
    return { id: observable.id, point, reference: observable.reference, countReference: observable.calibration, intervals: Object.fromEntries(
      Object.entries(draws).map(([key, values]) => [key, percentileInterval(values)])), tvReference };
  });
  const aggregate = (raw: number, correction: number, unavailable: boolean, varianceMissing: boolean): Metrics => ({
    rms: unavailable ? null : Math.sqrt(raw / populationCount), correctedMse: unavailable || varianceMissing ? null : correction / populationCount,
    correctedRms: unavailable || varianceMissing ? null : Math.sqrt(Math.max(0, correction / populationCount)) });
  const point = aggregate(pointMse, pointCorrected, pointMissing, pointMissingVariance);
  const aggregateDraws = mse.map((v, r) => aggregate(v, corrected[r], missing[r], missingVariance[r]));
  return { caseIndex, tier: plan.tier, replicates, confidence: 0.95, completedTrials: trials.length,
    expectedTrials: plan.trialsPerCase, trialIndices: sorted.map((t) => t.trial),
    interpretation: 'Available observations only; missingness may bias estimates. Marginal intervals are not simultaneous. Raw TV is not bias-corrected.',
    observables: results, meanErrorSummary: { point, intervals: Object.fromEntries(Object.keys(point).map((key) =>
      [key, percentileInterval(aggregateDraws.map((v) => v[key]))])) } };
}
