import { describe, expect, it } from 'vitest';
import {
  measureBirdsFlow,
  measureStarfieldBox,
  measureStarfieldViewport,
  measureTerrainPoint,
  terrainVertexAtDepth,
} from './complexityMeasurements';

describe('Birds complexity measurements', () => {
  it('measures cold-cache entry-flow ancestry over increasing epochs', () => {
    const measurements = [0, 1, 2, 3].map((epoch) => measureBirdsFlow(epoch));

    expect(measurements[0].recursiveCalls).toBe(1);
    for (const measurement of measurements) {
      expect(measurement.recursiveCalls).toBeGreaterThan(0);
      expect('dependencyPath' in measurement).toBe(false);
      // One epoch can traverse H, both incidence margins, F, E, D, C, B, and A.
      expect(measurement.maximumDepth).toBeLessThanOrEqual(10 * measurement.epoch + 1);
    }
  });

  it('exposes diffusion-dependent support cost', () => {
    const narrow = measureBirdsFlow(1, 0);
    const wide = measureBirdsFlow(1, 2);

    expect(wide.recursiveCalls).toBeGreaterThanOrEqual(narrow.recursiveCalls);
  });
});

describe('terrain complexity guardrails', () => {
  for (const family of ['square', 'diamond'] as const) {
    it(`keeps ${family}-step dependency growth linear in dyadic depth`, () => {
      for (const depth of [3, 4, 8, 12, 16]) {
        const measurement = measureTerrainPoint(family, depth);
        const recursiveCalls = measurement.verticesEvaluated + measurement.cacheHits;

        expect(measurement.verticesEvaluated).toBeLessThanOrEqual(8 * depth + 16);
        expect(recursiveCalls).toBeLessThanOrEqual(40 * depth);
        expect(measurement.maximumDepth).toBeLessThanOrEqual(depth + 4);
      }
    });
  }

  it('constructs increasingly fine vertices rather than refining one vertex query', () => {
    const coarse = terrainVertexAtDepth('square', 3);
    const fine = terrainVertexAtDepth('square', 8);

    expect(coarse).not.toEqual(fine);
    expect(fine.x - 0.5).toBe(2 ** -8);
    expect(fine.y - 0.25).toBe(2 ** -8);
  });
});

describe('starfield complexity guardrails', () => {
  for (const experiment of ['box-subdivision', 'box-expansion'] as const) {
    it(`keeps ${experiment} queries linear in hierarchy depth`, () => {
      for (const depth of [0, 1, 4, 8, 16]) {
        const measurement = measureStarfieldBox(experiment, depth);

        expect(measurement.cellsEvaluated + measurement.cacheHits).toBeLessThanOrEqual(
          2 * depth + 1,
        );
        expect(measurement.maximumDepth).toBeLessThanOrEqual(depth);
      }
    });
  }

  it('keeps fixed-grid viewport work linear in query count and hierarchy depth', () => {
    for (const scale of [-8, -4, 0, 4, 8]) {
      const measurement = measureStarfieldViewport(scale);
      const depthBound = Math.abs(scale) + 2;

      expect(measurement.cellsEvaluated).toBeLessThanOrEqual(
        measurement.queries * depthBound,
      );
      expect(measurement.cellsEvaluated + measurement.cacheHits).toBeLessThanOrEqual(
        measurement.queries * (depthBound + 1),
      );
      expect(measurement.maximumDepth).toBeLessThanOrEqual(Math.abs(scale) + 6);
    }
  });
});
