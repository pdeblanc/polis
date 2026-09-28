import { describe, expect, it } from 'vitest';
import { Birds2aRequestLimit, birds2aComplexityCase, birds2aComplexityCases, measureBirds2aComplexity } from './birds2aComplexity';
import { classifyBirds2aCell, classifyBirds2aFlow } from '../models/birds2a/classifiers';

describe('Birds 2a complexity measurements', () => {
  it('specifies distinct legal cases for both suites', () => {
    for (const sweep of [false, true]) {
      const cases = birds2aComplexityCases(sweep);
      expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
      for (const spec of cases) for (const query of spec.queries) {
        expect(query.role === 'cell' ? classifyBirds2aCell(query.cell, { min: 0, max: 1 })
          : classifyBirds2aFlow(query.flow, { min: 0, max: 1 })).toBeDefined();
      }
    }
  });

  it('separates retained expansion from contraction and warm root lookups', () => {
    const expansion = measureBirds2aComplexity(birds2aComplexityCase('expansion', 2), 10_000, 2);
    expect(expansion.expansionEpochs).toBe(3);
    expect(expansion.coldRequests).toBe(1);
    expect(expansion.warmRequests).toBe(1);
    expect(expansion.rootRankMax).toBe(0);
    const result = measureBirds2aComplexity(birds2aComplexityCase('viewport', 1, 16, 0), 100_000, 2);
    expect(result.queryCount).toBe(24);
    expect(result.coldRequests).toBeGreaterThan(result.queryCount);
    expect(result.coldUniqueNodes).toBeLessThanOrEqual(result.coldRequests);
    expect(result.warmRequests).toBe(result.queryCount);
    expect(result.warmUniqueNodes).toBe(result.queryCount);
    expect(Object.values(result.coldByRole).reduce((a, b) => a + b, 0)).toBe(result.coldRequests);
    for (const value of [result.setupMs, result.expansionMs, result.coldMs, result.warmMeanMs]) expect(value).toBeGreaterThanOrEqual(0);
  });

  it('has reproducible structural counts independent of timings', () => {
    const spec = birds2aComplexityCase('flow', 1, 16, 0);
    const a = measureBirds2aComplexity(spec), b = measureBirds2aComplexity(spec);
    for (const key of ['values', 'population', 'expansionEpochs', 'coldRequests', 'coldUniqueNodes', 'coldByRole', 'warmRequests'] as const) {
      expect(a[key]).toEqual(b[key]);
    }
  });

  it('stops diagnostic runaway work at the request budget', () => {
    expect(() => measureBirds2aComplexity(birds2aComplexityCase('cell', 2), 1)).toThrow(Birds2aRequestLimit);
    expect(() => measureBirds2aComplexity(birds2aComplexityCase('cell', 0), 0)).toThrow(RangeError);
  });
});
