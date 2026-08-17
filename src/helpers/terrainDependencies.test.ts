import { describe, expect, it } from 'vitest';
import { terrainDependencyGraph } from './terrainDependencies';

describe('terrainDependencyGraph', () => {
  it('stops immediately at a coarse-lattice vertex', () => {
    expect(terrainDependencyGraph({ x: 2, y: -3 })).toEqual({
      edges: [],
      vertices: [{ x: 2, y: -3 }],
    });
  });

  it('deduplicates shared ancestors and terminates at the coarse lattice', () => {
    const graph = terrainDependencyGraph({ x: 0.25, y: -0.5 });
    const keys = graph.vertices.map((vertex) => `${vertex.x},${vertex.y}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(graph.edges.length).toBeGreaterThan(graph.vertices.length);
    expect(
      graph.vertices
        .filter((vertex) => !graph.edges.some((edge) => edge.child === vertex))
        .every((vertex) => Number.isInteger(vertex.x) && Number.isInteger(vertex.y)),
    ).toBe(true);
  });
});
