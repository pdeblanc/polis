import { describe, expect, it } from 'vitest';
import { measureBirdsFlowMarginals } from './birdsFlowMeasurements';

describe('Birds flow marginal measurements', () => {
  it('is reproducible and checks complete public outflow conservation', () => {
    const options = {
      epoch: 1,
      sampleCount: 4,
      populationDensity: 0.5,
      diffusionRate: 0.5,
      sourceSpatialIndex: 1,
      sourceTimeIndex: 1,
      destinationOffsets: [-1, 0, 1],
      seedPrefix: 'flow-marginal-test',
    } as const;
    const first = measureBirdsFlowMarginals(options);
    const second = measureBirdsFlowMarginals(options);

    expect(second).toEqual(first);
    expect(first.map(({ destinationOffset }) => destinationOffset)).toEqual([-1, 0, 1]);
    expect(first.every(({ conservationFailures }) => conservationFailures === 0)).toBe(true);
    expect(first.every(({ meanSourcePopulation, meanOutflowPopulation }) =>
      meanSourcePopulation === meanOutflowPopulation)).toBe(true);
    expect(first.every(({ brownianProbability }) =>
      brownianProbability >= 0 && brownianProbability <= 1)).toBe(true);
  });
});
