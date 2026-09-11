/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicJson } from './evaluationCampaign';
import { analyzeEvaluationCase, bootstrapIndices, calibratePoissonTv, countMetrics, nearestRank, percentileInterval } from './evaluationInference';
import { countStatistics, smokeObservations, type SmokeTrial } from './evaluationSmoke';
import type { EvaluationPlan } from './evaluationProtocol';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';

const plan: EvaluationPlan = { tier: 'standard-A', strata: [[0, 0]], trialsPerCase: 512,
  cases: [{ L: 1, T: 1, D: 0, mu: 4, rho: 4 }] };
function synthetic(counts: number[]): SmokeTrial[] {
  return counts.map((count, trial) => ({ caseIndex: 0, trial, seed: `synthetic-${trial}`, status: 'complete',
    consistency: { checked: 0, failures: [] }, replayFailures: [], cache: {} as SmokeTrial['cache'],
    observations: smokeObservations(plan.cases[0], plan.strata).map((request) => ({ request, status: 'ok', elapsedMs: 0, count,
      flows: request.kind === 'outflows' || request.kind === 'inflows' ? [{ count,
        source: { min: request.min, max: request.max, time: request.time },
        destination: { min: request.min, max: request.max, time: request.time + 1 } }] : undefined })) }));
}

describe('saved-data evaluation inference', () => {
  it('analyzes saved synthetic checkpoints and resumes without overwriting results', () => {
    const directory = mkdtempSync(join(tmpdir(), 'polis-inference-test-'));
    try {
      const zeroPlan = { ...plan, cases: [{ ...plan.cases[0], mu: 0, rho: 0 }] };
      atomicJson(join(directory, 'manifest.json'), { format: 1, plan: zeroPlan, selectedCases: [0] });
      synthetic([0, 0]).forEach((result) => atomicJson(join(directory, `trial-0-${result.trial}.json`),
        { caseIndex: 0, trial: result.trial, elapsedMs: 1, status: 'complete', result }));
      const args = ['--import', 'tsx', 'src/benchmarks/evaluationInferenceReport.ts', directory];
      const invoke = () => execFileSync(process.execPath, args, { encoding: 'utf8' });
      expect(invoke()).toContain('saved');
      const path = join(directory, 'analysis-v1/case-0.json');
      const original = readFileSync(path, 'utf8');
      expect(JSON.parse(original)).toMatchObject({ replicates: 2000, completedTrials: 2, expectedTrials: 512 });
      expect(invoke()).toContain('already analyzed');
      expect(readFileSync(path, 'utf8')).toBe(original);
    } finally { rmSync(directory, { recursive: true }); }
  }, 20000);
  it('uses nearest-rank endpoints and rejects any undefined replicate', () => {
    expect(nearestRank([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentileInterval(Array.from({ length: 2000 }, (_, i) => i + 1))).toEqual({ interval: [50, 1950], undefinedReplicates: 0 });
    expect(percentileInterval([1, null, 3, NaN])).toEqual({ interval: null, undefinedReplicates: 2 });
  });
  it('matches the specified whole-realization random addresses', () => {
    const random = createAddressedRandom('Polis evaluation protocol 1 bootstrap');
    expect(bootstrapIndices(7, 9, 8)).toEqual(Array.from({ length: 8 }, (_, d) =>
      Math.floor(uniformUnit(random, ['A', 7, 9, -1, d]) * 8)));
  });
  it('matches point statistics, retaining missing observations and overflow', () => {
    const actual = countMetrics([2, undefined, 4, 100], [0, 1, 2, 3], 4);
    const expected = countStatistics([2, 4, 100], 4);
    expect(expected).toMatchObject(actual);
    expect(countMetrics([undefined], [0], 4).mean).toBeNull();
  });
  it('calibrates against the known one-draw Poisson(1) TV distribution', () => {
    // For one observation x, TV = 1 - Pr(X=x). P(X=0 or 1)=2/e.
    const result = calibratePoissonTv(0, 0, '["population",0,0]', 1, 1);
    expect(result.median).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(result.p95).toBeCloseTo(1 - Math.exp(-1) / 6, 10);
    expect(calibratePoissonTv(0, 0, 'zero', 0, 32, 20)).toMatchObject({ median: 0, p95: 0, K: 0 });
    expect(calibratePoissonTv(0, 0, 'missing', 1, 0, 20)).toMatchObject({ median: null, p95: null });
  });
  it('reports less histogram noise for larger reference samples', () => {
    const small = calibratePoissonTv(0, 0, 'sample-size', 4, 16, 100);
    const large = calibratePoissonTv(0, 0, 'sample-size', 4, 128, 100);
    expect(large.median!).toBeLessThan(small.median!);
  });
  it('preserves perfectly correlated cells, recomputes RMS, and is order independent', () => {
    const trials = synthetic([2, 4, 6, 8]);
    const result = analyzeEvaluationCase(0, trials, plan, 12);
    expect(analyzeEvaluationCase(0, [...trials].reverse(), plan, 12)).toEqual(result);
    const population = result.observables.find((o) => o.id === '0:population:0:0:false')!;
    const covariance = result.observables.find((o) => o.id === 'covariance:0:1:1')!;
    expect(covariance.point.covariance).toBeCloseTo(20 / 3);
    expect(covariance.intervals.covariance).toEqual(population.intervals.variance);
    const means = Array.from({ length: 12 }, (_, r) => bootstrapIndices(0, r, 4).reduce((s, i) => s + [2, 4, 6, 8][i], 0) / 4);
    expect(population.intervals.mean).toEqual(percentileInterval(means));
    expect(result.meanErrorSummary.point.rms).toBe(1);
    expect(result.meanErrorSummary.intervals.rms).toEqual(percentileInterval(means.map((m) => Math.abs(m - 4))));
  });
  it('keeps denominators and suppresses intervals when ratios become undefined', () => {
    const result = analyzeEvaluationCase(0, synthetic([0, 0]), plan, 4);
    const flow = result.observables.find((o) => o.id === '0:outflows:0:0:false:moments')!;
    expect(flow.point).toMatchObject({ birds: 0, mean: null });
    expect(flow.intervals.mean).toEqual({ interval: null, undefinedReplicates: 4 });
    const missing = synthetic([4, 4]);
    missing[0].observations.forEach((o) => { o.status = 'unsupported'; });
    const partial = analyzeEvaluationCase(0, missing, plan, 20).observables[0];
    expect(partial.point).toMatchObject({ samples: 1, mean: 4 });
    expect(partial.intervals.mean.interval).toBeNull();
    expect(partial.intervals.mean.undefinedReplicates).toBeGreaterThan(0);
  });
});
