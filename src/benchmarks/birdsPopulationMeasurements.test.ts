import { describe, expect, it } from 'vitest';
import {
  measureBirdsPopulationMarginal,
  summarizePopulationCounts,
  type BirdsPopulationCase,
} from './birdsPopulationMeasurements';

const TEST_CASE: BirdsPopulationCase = {
  name: 'test',
  epoch: 0,
  populationDensity: 0.25,
  diffusionRate: 0.5,
  spatialIndex: 0,
  timeIndex: 0,
};

describe('Birds population marginal measurements', () => {
  it('summarizes samples against the intended Poisson mean', () => {
    const result = summarizePopulationCounts(TEST_CASE, 16, [2, 4, 4, 6]);

    expect(result.poissonMean).toBe(4);
    expect(result.empiricalMean).toBe(4);
    expect(result.meanError).toBe(0);
    expect(result.empiricalVariance).toBeCloseTo(8 / 3);
    expect(result.varianceToMean).toBeCloseTo(2 / 3);
    expect(result.zeroFrequency).toBe(0);
    expect(result.totalVariationDistance).toBeGreaterThan(0);
    expect(result.totalVariationDistance).toBeLessThanOrEqual(1);
  });

  it('is reproducible without imposing a statistical acceptance threshold', () => {
    const first = measureBirdsPopulationMarginal(TEST_CASE, 8, 'population-test');
    const second = measureBirdsPopulationMarginal(TEST_CASE, 8, 'population-test');

    expect(second).toEqual(first);
    expect(first.minimum).toBe(4);
    expect(first.maximum).toBe(4);
  });
});
