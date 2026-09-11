import { describe, expect, it } from 'vitest';
import { SMOKE_CASES, smokeObservations, observe, countStatistics, runSmokeTrial, summarizeSmoke, smokeReferenceMoment } from './evaluationSmoke';
import { Birds } from '../models/birds/birds';

describe('evaluation smoke protocol', () => {
  it('fixes the four cases, strata, and uniquely addressed observations', () => {
    expect(SMOKE_CASES.map((c) => [c.L, c.D])).toEqual([[4, 0.5], [4, 2], [1, 0.5], [1, 2]]);
    const requests = smokeObservations(SMOKE_CASES[0]);
    expect(requests).toHaveLength(324);
    expect(new Set(requests.map((r) => r.id)).size).toBe(requests.length);
    expect(requests.some((r) => r.time < 0 && r.min < 0)).toBe(true);
  });
  it('does not silently accept snapped observation times', () => {
    const c = SMOKE_CASES[0];
    const request = { ...smokeObservations(c)[0], time: 0.01 };
    expect(observe(new Birds('smoke', c.rho, c.D), c, request).status).toBe('unsupported');
  });
  it('keeps empty statistics unavailable and uses reference-defined TV bins', () => {
    expect(countStatistics([], 4)).toEqual({ samples: 0 });
    expect(countStatistics([0, 0], 0)).toMatchObject({ mean: 0, variance: 0, tv: 0, K: 0, varianceToMean: null });
    expect(countStatistics([2, 4], 4)).toMatchObject({ mean: 3, variance: 2, meanError: -1 });
  });
  it('checks the binned reference moment with an explicit Gaussian tail bound', () => {
    for (const c of SMOKE_CASES) {
      const first = smokeReferenceMoment(c);
      const tighter = smokeReferenceMoment(c, 1e-12);
      expect(first.tailBound).toBeLessThanOrEqual(1e-10);
      expect(Math.abs(first.secondMoment - tighter.secondMoment)).toBeLessThan(1e-8);
      expect(first.secondMoment).toBeGreaterThan(0);
    }
  });
  it('retains errors instead of converting failed populations into zeros', () => {
    const model = new Birds('smoke-failure', 1, 0.5);
    const request = { ...smokeObservations(SMOKE_CASES[0])[0], min: Number.NaN };
    const result = observe(model, SMOKE_CASES[0], request);
    expect(result.status).toBe('error');
    expect(result.count).toBeUndefined();
    expect(result.detail).toBeTruthy();
  });
  it('replays a same-seed trial and computes supported metrics', () => {
    const trial = runSmokeTrial(0, 0);
    expect(trial.replayFailures).toEqual([]);
    expect(trial.consistency.failures).toEqual([]);
    const summary = summarizeSmoke(0, [trial]);
    expect(summary.completedTrials).toBe(1);
    expect(summary.marginals[0].samples).toBe(1);
    expect(summary.covariances[0].covariance).toBeNull();
  });
});
