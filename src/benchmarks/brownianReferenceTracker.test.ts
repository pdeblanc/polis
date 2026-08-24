import { describe, expect, it } from 'vitest';
import { measureBrownianReferenceTracker } from './brownianReferenceTracker';

describe('Brownian anonymous reference tracker', () => {
  it('tracks every nonempty stationary bird at zero diffusion', () => {
    const result = measureBrownianReferenceTracker({
      candidateCount: 50,
      cellWidth: 1,
      diffusionRate: 0,
      maxQueries: 1_000,
      maxRefinements: 32,
      populationDensity: 0.25,
      ringCellCount: 64,
      seedPrefix: 'reference-tracker-zero-test',
      sourceCellIndex: 0,
      steps: 4,
      timeStep: 1,
    });

    expect(result.summary.completePaths).toBe(
      result.summary.attemptedCandidates - result.summary.emptyStarts,
    );
    expect(result.summary.trackedWrongLabelPaths).toBe(0);
    expect(result.summary.queryBudgetFailures).toBe(0);
    expect(result.summary.refinementBudgetFailures).toBe(0);
    expect(result.summary.numericResolutionFailures).toBe(0);
    expect(result.summary.errorFailures).toBe(0);
  });

  it('resolves sampled join-split-rejoin paths without consulting label truth', () => {
    const result = measureBrownianReferenceTracker({
      candidateCount: 100,
      cellWidth: 1,
      diffusionRate: 1,
      maxQueries: 10_000,
      maxRefinements: 32,
      populationDensity: 1,
      ringCellCount: 32,
      seedPrefix: 'reference-tracker-recurrence-test',
      sourceCellIndex: 0,
      steps: 8,
      timeStep: 1,
    });

    expect(result.summary.joinSplitRejoinPaths).toBeGreaterThan(0);
    expect(result.summary.completedJoinSplitRejoinPaths).toBeGreaterThan(0);
    expect(result.summary.trackedWrongLabelPaths).toBe(0);
  });
});
