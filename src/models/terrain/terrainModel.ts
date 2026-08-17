import type { Point2D } from '../../utils/geometry/point2d';
import type { Seed } from '../../utils/rng/addressedRandom';
import { TerrainField, type TerrainQueryStats, type TerrainVertex } from './terrain';

export type TerrainSample = {
  readonly height: number;
  readonly vertex: TerrainVertex;
};

/** Consumer-facing terrain API. It can query, but cannot create stochastic facts. */
export class TerrainModel {
  readonly #field: TerrainField;

  constructor(seed: Seed) {
    this.#field = new TerrainField(seed);
  }

  sampleNearest(point: Point2D, spacing: number): TerrainSample {
    if (!(spacing > 0) || !Number.isFinite(spacing) || !Number.isInteger(Math.log2(spacing))) {
      throw new RangeError('Terrain sampling spacing must be a positive power of two');
    }
    const vertex = {
      x: Math.round(point.x / spacing) * spacing,
      y: Math.round(point.y / spacing) * spacing,
    };
    return { height: this.#field.queryVertex(vertex), vertex };
  }

  getLastQueryStats(): TerrainQueryStats {
    return this.#field.getLastQueryStats();
  }

  getCacheUsage(): { readonly capacity: number; readonly entries: number } {
    return this.#field.getCacheUsage();
  }

  clearCache(): void {
    this.#field.clearCache();
  }
}
