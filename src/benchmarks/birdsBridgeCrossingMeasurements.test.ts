import { describe, expect, it } from 'vitest';
import type { BirdFlow } from '../models/birds/entities';
import {
  brownianBridgeMidpointProbability,
  measureBirdsBridgeAndCrossing,
} from './birdsBridgeCrossingMeasurements';

describe('Birds bridge and crossing measurements', () => {
  it('integrates the conditioned Brownian midpoint distribution', () => {
    const flow: BirdFlow = {
      source: { min: 0, max: 1, time: 0 },
      destination: { min: 0, max: 1, time: 1 },
    };
    const probabilities = Array.from({ length: 21 }, (_, offset) => offset - 10).map(
      (index) =>
        brownianBridgeMidpointProbability(
          flow,
          { min: index, max: index + 1, time: 0.5 },
          1,
        ),
    );

    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
    expect(probabilities[9]).toBeCloseTo(probabilities[11], 10);
  });

  it('exposes zero-diffusion child reshuffling against perfect Brownian retention', () => {
    const result = measureBirdsBridgeAndCrossing({
      diffusionRate: 0,
      epoch: 1,
      populationDensity: 4,
      seedPrefix: 'bridge-crossing-test',
      trials: 4,
    });

    expect(result.bridges.every(({ empiricalConfiguredTotalVariation }) =>
      empiricalConfiguredTotalVariation === 0)).toBe(true);
    expect(result.crossings[0].brownianRetentionProbability).toBe(1);
    expect(result.crossings[0].birdsCrossingProbability).toBeGreaterThan(0);
    expect(
      result.crossings[0].birdsRetentionProbability +
        result.crossings[0].birdsCrossingProbability,
    ).toBeCloseTo(1, 12);
  });
});
