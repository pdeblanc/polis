import { describe, expect, it } from 'vitest';
import { measureBirdsTrajectories } from './birdsTrajectoryMeasurements';

describe('Birds trajectory measurements', () => {
  it('records every candidate outcome and is reproducible', () => {
    const options = {
      epoch: 1,
      maximumCandidates: 6,
      retainedCollisionFreePaths: 2,
      steps: 2,
      populationDensity: 1 / 16,
      diffusionRate: 0,
      sourceSpatialIndex: 0,
      sourceTimeIndex: 1,
      seedPrefix: 'trajectory-test',
    } as const;
    const first = measureBirdsTrajectories(options);
    const second = measureBirdsTrajectories(options);

    expect(second).toEqual(first);
    expect(first.map(({ horizon }) => horizon)).toEqual([1, 2]);
    const summary = first[0];
    expect(
      summary.emptyStarts +
        summary.completedPaths +
        summary.queryBudgetFailures +
        summary.refinementBudgetFailures +
        summary.numericFailures +
        summary.errorFailures,
    ).toBe(summary.attemptedCandidates);
    expect(summary.collisionFreePaths).toBeLessThanOrEqual(2);
    expect(summary.retainedCandidateIndices.split(',').filter(Boolean)).toHaveLength(
      summary.collisionFreePaths,
    );
    expect(
      summary.collisionFreeEligiblePaths,
    ).toBe(summary.collisionFreePaths + summary.retentionOverflowPaths);
    expect(summary.completedPaths).toBe(
      summary.collisionFreeEligiblePaths + summary.collisionRejectedCompletedPaths,
    );
  });
});
