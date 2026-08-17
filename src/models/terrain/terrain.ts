import { LRUCache } from 'lru-cache';
import { normal } from '../../utils/distributions/normal';
import {
  createAddressedRandom,
  type AddressedRandom,
  type Seed,
} from '../../utils/rng/addressedRandom';

export const TERRAIN_COARSE_STANDARD_DEVIATION = 1;
export const TERRAIN_DISPLACEMENT_VARIANCE_PER_WORLD_UNIT = 1;
export const TERRAIN_VERTEX_CACHE_CAPACITY = 50_000;

const ASYMPTOTIC_PARENT_WEIGHT_SLOPE = 0.2355;
const CALIBRATED_PARENT_WEIGHTS = new Map<number, number>([
  [0.5, 1.113029854163348],
  [Math.SQRT1_2, 1.0823922002923938],
  [0.25, 1.0644571763647044],
  [Math.SQRT2 / 4, 1.0870574162344748],
  [0.125, 1.0323611210103034],
  [Math.SQRT2 / 8, 1.0459557458793551],
  [0.0625, 1.0157787462588443],
  [Math.SQRT2 / 16, 1.0226229210706235],
  [0.03125, 1.0076789623236841],
  [Math.SQRT2 / 32, 1.011001938403367],
  [0.015625, 1.0037588449846269],
  [Math.SQRT2 / 64, 1.005367887409082],
  [0.0078125, 1.0018521729111367],
  [Math.SQRT2 / 128, 1.002636550749837],
  [0.00390625, 1.0009174938512964],
  [Math.SQRT2 / 256, 1.0013028712601109],
]);

export type TerrainVertex = {
  readonly x: number;
  readonly y: number;
};

export type TerrainQueryStats = {
  readonly cacheHits: number;
  readonly maximumDepth: number;
  readonly randomValuesRequested: number;
  readonly verticesEvaluated: number;
};

type MutableStats = {
  cacheHits: number;
  maximumDepth: number;
  randomValuesRequested: number;
  verticesEvaluated: number;
};

type ParentGeometry = {
  readonly distance: number;
  readonly parents: readonly TerrainVertex[];
};

/** Internal stochastic diamond-square lattice. */
export class TerrainField {
  readonly #random: AddressedRandom;
  readonly #cache = new LRUCache<string, number>({ max: TERRAIN_VERTEX_CACHE_CAPACITY });
  #lastQueryStats: TerrainQueryStats = emptyStats();

  constructor(seed: Seed) {
    this.#random = createAddressedRandom(seed);
  }

  queryVertex(vertex: TerrainVertex): number {
    const canonical = canonicalVertex(vertex);
    const stats = emptyStats();
    const value = this.#queryVertex(canonical, stats, 0);
    this.#lastQueryStats = stats;
    return value;
  }

  getLastQueryStats(): TerrainQueryStats {
    return this.#lastQueryStats;
  }

  clearCache(): void {
    this.#cache.clear();
  }

  #queryVertex(vertex: TerrainVertex, stats: MutableStats, depth: number): number {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const key = vertexKey(vertex);
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.verticesEvaluated += 1;
    stats.randomValuesRequested += 1;
    const geometry = parentGeometry(vertex);
    let value: number;
    if (geometry === undefined) {
      value = normal(
        this.#random,
        ['terrain.coarse-height', vertex.x, vertex.y],
        0,
        TERRAIN_COARSE_STANDARD_DEVIATION,
      );
    } else {
      const parentMean = geometry.parents.reduce(
        (sum, parent) => sum + this.#queryVertex(parent, stats, depth + 1),
        0,
      ) / geometry.parents.length;
      const parentWeight = parentWeightForDistance(geometry.distance);
      value = normal(
        this.#random,
        ['terrain.displacement', vertex.x, vertex.y],
        parentWeight * parentMean,
        Math.sqrt(TERRAIN_DISPLACEMENT_VARIANCE_PER_WORLD_UNIT * geometry.distance),
      );
    }

    this.#cache.set(key, value);
    return value;
  }
}

function parentWeightForDistance(distance: number): number {
  return CALIBRATED_PARENT_WEIGHTS.get(distance) ?? 1 + ASYMPTOTIC_PARENT_WEIGHT_SLOPE * distance;
}

export function canonicalVertex(vertex: TerrainVertex): TerrainVertex {
  if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
    throw new RangeError('Terrain vertex coordinates must be finite');
  }
  return {
    x: Object.is(vertex.x, -0) ? 0 : vertex.x,
    y: Object.is(vertex.y, -0) ? 0 : vertex.y,
  };
}

export function parentVertices(vertex: TerrainVertex): readonly TerrainVertex[] {
  return parentGeometry(canonicalVertex(vertex))?.parents ?? [];
}

export function parentDistance(vertex: TerrainVertex): number | undefined {
  return parentGeometry(canonicalVertex(vertex))?.distance;
}

function parentGeometry(vertex: TerrainVertex): ParentGeometry | undefined {
  if (Number.isInteger(vertex.x) && Number.isInteger(vertex.y)) return undefined;

  const spacing = dyadicIntroductionSpacing(vertex);
  const column = vertex.x / spacing;
  const row = vertex.y / spacing;
  const squareStep = Math.abs(column % 2) === 1 && Math.abs(row % 2) === 1;

  if (squareStep) {
    return {
      distance: Math.SQRT2 * spacing,
      parents: [
        { x: vertex.x - spacing, y: vertex.y - spacing },
        { x: vertex.x + spacing, y: vertex.y - spacing },
        { x: vertex.x - spacing, y: vertex.y + spacing },
        { x: vertex.x + spacing, y: vertex.y + spacing },
      ],
    };
  }

  return {
    distance: spacing,
    parents: [
      { x: vertex.x - spacing, y: vertex.y },
      { x: vertex.x + spacing, y: vertex.y },
      { x: vertex.x, y: vertex.y - spacing },
      { x: vertex.x, y: vertex.y + spacing },
    ],
  };
}

function dyadicIntroductionSpacing(vertex: TerrainVertex): number {
  let spacing = 1;
  let column = vertex.x;
  let row = vertex.y;

  while (!Number.isInteger(column) || !Number.isInteger(row)) {
    spacing /= 2;
    column *= 2;
    row *= 2;
    if (spacing === 0) {
      throw new RangeError('Terrain vertex coordinates must be finite dyadic rationals');
    }
  }

  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) {
    throw new RangeError('Terrain vertex lattice indices must be safe integers');
  }
  return spacing;
}

function vertexKey(vertex: TerrainVertex): string {
  return `${vertex.x},${vertex.y}`;
}

function emptyStats(): MutableStats {
  return {
    cacheHits: 0,
    maximumDepth: 0,
    randomValuesRequested: 0,
    verticesEvaluated: 0,
  };
}
