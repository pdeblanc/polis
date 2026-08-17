import { describe, expect, it } from 'vitest';
import {
  measureStarfieldBox,
  measureStarfieldViewport,
  measureTerrainPoint,
  terrainVertexAtDepth,
} from './complexityMeasurements';

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
