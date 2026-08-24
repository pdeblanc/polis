import { describe, expect, it } from 'vitest';
import { measureBrownianTrajectories } from './brownianTrajectoryMeasurements';

describe('Brownian trajectory reference', () => {
  it('is reproducible and preserves a selected path at zero diffusion', () => {
    const options = {
      candidateCount: 100,
      cellWidth: 1,
      diffusionRate: 0,
      populationDensity: 1 / 16,
      retainedCollisionFreePaths: 3,
      ringCellCount: 64,
      seedPrefix: 'brownian-reference-test',
      sourceSpatialIndex: 0,
      steps: 4,
      stopWhenRetentionFilled: true,
      timeStep: 1,
    } as const;
    const first = measureBrownianTrajectories(options);

    expect(measureBrownianTrajectories(options)).toEqual(first);
    expect(first.map(({ horizon }) => horizon)).toEqual([1, 2, 4]);
    expect(first[0].collisionFreePaths).toBe(3);
    expect(first[0].meanIncrement).toBe(0);
    expect(first[0].oneStepIncrementVariance).toBe(0);
    expect(first[0].collisionThenSeparationPaths).toBe(0);
    expect(first[0].joinSplitRejoinPaths).toBe(0);
  });

  it('observes separation and recurrence using labeled ground truth', () => {
    const [measurement] = measureBrownianTrajectories({
      candidateCount: 100,
      cellWidth: 1,
      diffusionRate: 1,
      populationDensity: 1,
      retainedCollisionFreePaths: 100,
      ringCellCount: 16,
      seedPrefix: 'brownian-collision-pattern-test',
      sourceSpatialIndex: 0,
      steps: 8,
      timeStep: 1,
    });

    expect(measurement.collisionThenSeparationPaths).toBeGreaterThan(0);
    expect(measurement.joinSplitRejoinPaths).toBeGreaterThan(0);
    expect(
      measurement.emptyStarts +
        measurement.collisionFreeEligiblePaths +
        measurement.collisionRejectedPaths,
    ).toBe(measurement.attemptedCandidates);
  });
});
