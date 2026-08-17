import { describe, expect, it } from 'vitest';
import { canonicalVertex, parentDistance, parentVertices, TerrainField } from './terrain';

describe('terrain lattice', () => {
  it('normalizes negative zero without attaching a refinement level', () => {
    expect(canonicalVertex({ x: -0, y: 0.75 })).toEqual({ x: 0, y: 0.75 });
  });

  it('gives square-step vertices four diagonal parents', () => {
    expect(parentVertices({ x: 0.5, y: 0.5 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    expect(parentDistance({ x: 0.5, y: 0.5 })).toBeCloseTo(Math.SQRT1_2);
  });

  it('gives diamond-step vertices four axial parents', () => {
    expect(parentVertices({ x: -0.5, y: 0 })).toEqual([
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: -0.5, y: -0.5 },
      { x: -0.5, y: 0.5 },
    ]);
    expect(parentDistance({ x: -0.5, y: 0 })).toBe(0.5);
  });

  it('derives finer parent geometry directly from dyadic coordinates', () => {
    expect(parentVertices({ x: 0.25, y: -0.5 })).toEqual([
      { x: 0, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.25, y: -0.75 },
      { x: 0.25, y: -0.25 },
    ]);
    expect(parentDistance({ x: 0.25, y: -0.5 })).toBe(0.25);
  });
});

describe('TerrainField', () => {
  it('is deterministic across instances and query order', () => {
    const vertex = { x: -13 / 32, y: 0.25 };
    const first = new TerrainField('terrain-order');
    const expected = first.queryVertex(vertex);
    first.queryVertex({ x: 0.75, y: -0.25 });

    const reverse = new TerrainField('terrain-order');
    reverse.queryVertex({ x: 0.75, y: -0.25 });
    expect(first.queryVertex(vertex)).toBe(expected);
    expect(reverse.queryVertex(vertex)).toBe(expected);
  });

  it('reports per-query cache and dependency statistics', () => {
    const terrain = new TerrainField('terrain-stats');
    terrain.queryVertex({ x: 3 / 16, y: 0.125 });
    const cold = terrain.getLastQueryStats();

    expect(cold.verticesEvaluated).toBeGreaterThan(1);
    expect(cold.maximumDepth).toBeGreaterThan(0);
    expect(cold.randomValuesRequested).toBe(cold.verticesEvaluated);

    terrain.queryVertex({ x: 3 / 16, y: 0.125 });
    expect(terrain.getLastQueryStats()).toEqual({
      cacheHits: 1,
      maximumDepth: 0,
      randomValuesRequested: 0,
      verticesEvaluated: 0,
    });
  });

  it('clears its cache without changing values', () => {
    const terrain = new TerrainField('terrain-cache');
    const vertex = { x: 0.625, y: -0.25 };
    const expected = terrain.queryVertex(vertex);
    expect(terrain.getCacheUsage().entries).toBeGreaterThan(0);
    terrain.clearCache();
    expect(terrain.getCacheUsage()).toEqual({ capacity: 50_000, entries: 0 });

    expect(terrain.queryVertex(vertex)).toBe(expected);
    expect(terrain.getLastQueryStats().verticesEvaluated).toBeGreaterThan(0);
  });

  it('keeps marginal mean and variance stable across vertex geometries', () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0 },
      { x: 3 / 16, y: -0.125 },
    ];
    const samples = vertices.map(() => [] as number[]);

    for (let index = 0; index < 512; index += 1) {
      const terrain = new TerrainField(`terrain-marginal-${index}`);
      vertices.forEach((vertex, vertexIndex) => {
        samples[vertexIndex].push(terrain.queryVertex(vertex));
      });
    }

    for (const values of samples) {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      expect(Math.abs(mean)).toBeLessThan(0.15);
      expect(variance).toBeGreaterThan(0.8);
      expect(variance).toBeLessThan(1.2);
    }
  });
});
