import { describe, expect, it } from 'vitest';
import { measureBirdsPopulationPhases } from './birdsPopulationPhases';

describe('Birds population phase measurements', () => {
  it('samples complete spatial phase blocks reproducibly', () => {
    const options = {
      epoch: 1,
      sampleCount: 4,
      populationDensity: 0.5,
      diffusionRate: 0.5,
      timeIndices: [0, 1],
      seedPrefix: 'population-phase-test',
    } as const;
    const first = measureBirdsPopulationPhases(options);
    const second = measureBirdsPopulationPhases(options);

    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({
      spatialPhases: 2,
      referenceMeanPerCell: 4,
      referenceAggregateMean: 8,
      aggregateMean: 8,
      aggregateMeanError: 0,
    });
    expect(first[0].meanPerCell).toBe(4);
  });
});
