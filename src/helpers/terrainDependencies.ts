import {
  canonicalVertex,
  parentVertices,
  type TerrainVertex,
} from '../models/terrain/diamondSquareTerrain';

export type TerrainDependencyEdge = {
  readonly child: TerrainVertex;
  readonly parent: TerrainVertex;
};

export type TerrainDependencyGraph = {
  readonly edges: readonly TerrainDependencyEdge[];
  readonly vertices: readonly TerrainVertex[];
};

export function terrainDependencyGraph(requested: TerrainVertex): TerrainDependencyGraph {
  const root = canonicalVertex(requested);
  const vertices = [root];
  const edges: TerrainDependencyEdge[] = [];
  const visited = new Set([vertexKey(root)]);

  for (let index = 0; index < vertices.length; index += 1) {
    const child = vertices[index];
    for (const parent of parentVertices(child)) {
      edges.push({ child, parent });
      const key = vertexKey(parent);
      if (visited.has(key)) continue;
      visited.add(key);
      vertices.push(parent);
    }
  }

  return { edges, vertices };
}

function vertexKey(vertex: TerrainVertex): string {
  return `${vertex.x},${vertex.y}`;
}
