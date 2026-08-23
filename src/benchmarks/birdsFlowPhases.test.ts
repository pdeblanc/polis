import { describe, expect, it } from 'vitest';
import { brownianBinnedDisplacementMoments } from '../utils/math/brownian';
import {
  measureBirdsFlowPhases,
  predictSpatialRefinementSecondMoment,
} from './birdsFlowPhases';

describe('Birds flow phase measurements', () => {
  it('samples complete phase blocks reproducibly and conservatively', () => {
    const options = {
      epoch: 1,
      sampleCount: 3,
      populationDensity: 0.5,
      diffusionRate: 0.5,
      timeIndices: [1, 4],
      seedPrefix: 'flow-phase-test',
    } as const;
    const first = measureBirdsFlowPhases(options);
    const second = measureBirdsFlowPhases(options);

    expect(second).toEqual(first);
    expect(first.details).toHaveLength(4);
    expect(first.summaries).toHaveLength(2);
    expect(first.summaries.every(({ conservationFailures }) => conservationFailures === 0))
      .toBe(true);
    expect(first.summaries.every(({ aggregateDriftInCellWidths }) =>
      Number.isFinite(aggregateDriftInCellWidths))).toBe(true);
    for (const summary of first.summaries) {
      expect(summary.referenceSecondMoment).toBeGreaterThan(0);
      expect(summary.withinPhaseVariance + summary.betweenPhaseDriftVariance)
        .toBeCloseTo(summary.aggregateVariance, 12);
    }
    expect(first.summaries[0].spatialRefinementPredictedSecondMoment).toBeNull();
    expect(first.summaries[1].spatialRefinementPredictedSecondMoment).not.toBeNull();
    const spatial = first.summaries[1];
    expect(
      spatial.spatialRefinementParentContribution! +
        spatial.spatialRefinementEndpointContribution! +
        spatial.spatialRefinementCrossContribution!,
    ).toBeCloseTo(spatial.aggregateSecondMoment, 12);
  });

  it('adds independent endpoint-half variance after rescaling the parent displacement', () => {
    const parent = brownianBinnedDisplacementMoments(2, 1, 0.5).secondMoment;
    expect(predictSpatialRefinementSecondMoment(1, 1, 0.5)).toBeCloseTo(parent + 0.5, 14);
  });
});
