import { describe, expect, it } from 'vitest';
import { TerrainField } from './terrain';
import { TerrainModel } from './terrainModel';

describe('TerrainModel', () => {
  it('samples the nearest vertex at the requested dyadic spacing', () => {
    const model = new TerrainModel('terrain-api');
    const sample = model.sampleNearest({ x: 0.37, y: -0.61 }, 0.25);

    expect(sample.vertex).toEqual({ x: 0.25, y: -0.5 });
    expect(sample.height).toBe(
      new TerrainField('terrain-api').queryVertex({ x: 0.25, y: -0.5 }),
    );
  });

  it('rejects non-dyadic sampling spacing', () => {
    const model = new TerrainModel('terrain-api');

    expect(() => model.sampleNearest({ x: 0, y: 0 }, 0.3)).toThrow(RangeError);
    expect(() => model.sampleNearest({ x: 0, y: 0 }, 0)).toThrow(RangeError);
  });

  it('exposes query statistics and cache clearing without exposing randomness', () => {
    const model = new TerrainModel('terrain-api-cache');
    const point = { x: 0.375, y: 0.125 };
    const expected = model.sampleNearest(point, 0.125).height;
    expect(model.getLastQueryStats().verticesEvaluated).toBeGreaterThan(0);
    expect(model.getCacheUsage().entries).toBeGreaterThan(0);

    expect(model.sampleNearest(point, 0.125).height).toBe(expected);
    expect(model.getLastQueryStats().cacheHits).toBe(1);

    model.clearCache();
    expect(model.getCacheUsage()).toEqual({ capacity: 50_000, entries: 0 });
    expect(model.sampleNearest(point, 0.125).height).toBe(expected);
    expect(model.getLastQueryStats().verticesEvaluated).toBeGreaterThan(0);
  });
});
