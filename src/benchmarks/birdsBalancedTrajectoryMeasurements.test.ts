import { describe, expect, it } from 'vitest';
import { measureBirdsBalancedTrajectories } from './birdsBalancedTrajectoryMeasurements';

describe('Birds balanced trajectory measurements', () => {
  it('uses equal quotas over the complete spatial and temporal phase grid', () => {
    const result = measureBirdsBalancedTrajectories({
      epoch: 1,
      candidatesPerPhase: 8,
      pathsPerPhase: 1,
      steps: 1,
      populationDensity: 1 / 16,
      diffusionRate: 0,
      seedPrefix: 'balanced-trajectory-test',
    });

    expect(result.phases).toHaveLength(8);
    expect(new Set(result.phases.map(({ timeIndex }) => timeIndex))).toEqual(
      new Set([1, 2, 3, 4]),
    );
    expect(new Set(result.phases.map(({ spatialIndex }) => spatialIndex))).toEqual(
      new Set([0, 1]),
    );
    expect(result.phases.every(({ retainedPaths }) => retainedPaths <= 1)).toBe(true);
    expect(result.summaries[0].balancedPaths).toBe(
      result.phases.reduce((sum, phase) => sum + phase.retainedPaths, 0),
    );
  });
});
