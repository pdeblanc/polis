import { LRUCache } from 'lru-cache';
import { binomialHalf } from '../../utils/distributions/binomialHalf';
import { poisson } from '../../utils/distributions/poisson';
import { uniform } from '../../utils/distributions/uniform';
import type { Point2D } from '../../utils/geometry/point2d';
import {
  createAddressedRandom,
  type AddressedRandom,
  type Seed,
} from '../../utils/rng/addressedRandom';
import { dependencyAncestor, type HierarchyCell } from './hierarchy';

export const STAR_DENSITY = 8;
export const STAR_MATERIALIZATION_THRESHOLD = 64;
export const STARFIELD_CELL_CACHE_CAPACITY = 20_000;
export const STARFIELD_SUBDIVISION_CACHE_CAPACITY = 20_000;

export type PopulationCount = number;

export type StarfieldCellResult = {
  readonly count: PopulationCount;
  readonly positions?: readonly Point2D[];
};

export type StarfieldChildResult = {
  readonly count: PopulationCount;
  readonly positions?: readonly Point2D[];
};

export type StarfieldSubdivisionResult = StarfieldCellResult & {
  readonly children: readonly [
    StarfieldChildResult,
    StarfieldChildResult,
    StarfieldChildResult,
    StarfieldChildResult,
  ];
};

export type StarfieldQueryStats = {
  readonly cacheHits: number;
  readonly cellsEvaluated: number;
  readonly maximumDepth: number;
  readonly poissonSamples: number;
  readonly populationSplits: number;
  readonly starsMaterialized: number;
};

type MutableStats = {
  cacheHits: number;
  cellsEvaluated: number;
  maximumDepth: number;
  poissonSamples: number;
  populationSplits: number;
  starsMaterialized: number;
};

export type HierarchicalStarfieldOptions = {
  readonly cellCacheCapacity?: number;
  readonly subdivisionCacheCapacity?: number;
};

export class HierarchicalStarfield {
  readonly #random: AddressedRandom;
  readonly #cellCache: LRUCache<string, StarfieldCellResult>;
  readonly #subdivisionCache: LRUCache<string, StarfieldSubdivisionResult>;
  #lastQueryStats: StarfieldQueryStats = emptyStats();

  constructor(seed: Seed, options: HierarchicalStarfieldOptions = {}) {
    this.#random = createAddressedRandom(seed);
    this.#cellCache = new LRUCache({
      max: options.cellCacheCapacity ?? STARFIELD_CELL_CACHE_CAPACITY,
    });
    this.#subdivisionCache = new LRUCache({
      max: options.subdivisionCacheCapacity ?? STARFIELD_SUBDIVISION_CACHE_CAPACITY,
    });
  }

  queryCell(cell: HierarchyCell): StarfieldCellResult {
    const stats = emptyStats();
    const result = this.#queryCell(cell, stats, 0);
    this.#lastQueryStats = stats;
    return result;
  }

  querySubdivision(cell: HierarchyCell): StarfieldSubdivisionResult {
    const stats = emptyStats();
    const result = this.#querySubdivision(cell, stats, 0);
    this.#lastQueryStats = stats;
    return result;
  }

  getLastQueryStats(): StarfieldQueryStats {
    return this.#lastQueryStats;
  }

  getCacheUsage(): { readonly capacity: number; readonly entries: number } {
    return {
      capacity: this.#cellCache.max + this.#subdivisionCache.max,
      entries: this.#cellCache.size + this.#subdivisionCache.size,
    };
  }

  clearCache(): void {
    this.#cellCache.clear();
    this.#subdivisionCache.clear();
  }

  #queryCell(cell: HierarchyCell, stats: MutableStats, depth: number): StarfieldCellResult {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const key = cellKey(cell);
    const cached = this.#cellCache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.cellsEvaluated += 1;
    const ancestor = dependencyAncestor(cell);
    let result: StarfieldCellResult;

    if (ancestor === undefined) {
      stats.poissonSamples += 1;
      const count = poisson(this.#random, cellAddress('root-count', cell), STAR_DENSITY);
      result = this.#finishCell(cell, count, undefined, stats);
    } else if (ancestor.relativeSize === 'smaller') {
      const subdivision = this.#querySubdivision(cell, stats, depth);
      result = { count: subdivision.count, positions: subdivision.positions };
    } else {
      const parent = this.#querySubdivision(ancestor.cell, stats, depth + 1);
      const inherited = parent.children[childIndexOf(ancestor.cell, cell)];
      result = this.#finishCell(cell, inherited.count, inherited.positions, stats);
    }

    this.#cellCache.set(key, result);
    return result;
  }

  #querySubdivision(
    cell: HierarchyCell,
    stats: MutableStats,
    depth: number,
  ): StarfieldSubdivisionResult {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const key = cellKey(cell);
    const cached = this.#subdivisionCache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.cellsEvaluated += 1;
    const ancestor = dependencyAncestor(cell);
    const result = ancestor?.relativeSize === 'smaller'
      ? this.#queryExpansionSubdivision(cell, ancestor.cell, stats, depth)
      : this.#queryOrdinarySubdivision(cell, stats, depth);
    this.#subdivisionCache.set(key, result);
    return result;
  }

  #queryExpansionSubdivision(
    cell: HierarchyCell,
    smallerAncestor: HierarchyCell,
    stats: MutableStats,
    depth: number,
  ): StarfieldSubdivisionResult {
    const existing = this.#queryCell(smallerAncestor, stats, depth + 1);
    const existingIndex = childIndexOf(cell, smallerAncestor);
    const counts: [number, number, number, number] = [0, 0, 0, 0];
    counts[existingIndex] = existing.count;
    const childArea = smallerAncestor.edgeLength ** 2;

    for (let index = 0; index < counts.length; index += 1) {
      if (index === existingIndex) continue;
      stats.poissonSamples += 1;
      counts[index] = poisson(
        this.#random,
        [...cellAddress('expansion-count', cell), index],
        STAR_DENSITY * childArea,
      );
    }

    const count = sum(counts);
    if (count > STAR_MATERIALIZATION_THRESHOLD) {
      return { count, children: childResults(counts) };
    }

    const childPositions: [Point2D[], Point2D[], Point2D[], Point2D[]] = [[], [], [], []];
    childPositions[existingIndex] = [...(existing.positions ?? [])];
    for (let index = 0; index < counts.length; index += 1) {
      if (index === existingIndex) continue;
      childPositions[index] = this.#materialize(childAt(cell, index), counts[index], stats);
    }
    const positions = childPositions.flat();
    return {
      count,
      children: childrenWithPositions(counts, childPositions),
      positions,
    };
  }

  #queryOrdinarySubdivision(
    cell: HierarchyCell,
    stats: MutableStats,
    depth: number,
  ): StarfieldSubdivisionResult {
    const whole = this.#queryCell(cell, stats, depth);
    if (whole.positions === undefined) {
      const counts = this.#splitPopulation(cell, whole.count, stats);
      return { ...whole, children: childResults(counts) };
    }

    const childPositions = classifyStarPositions(cell, whole.positions);
    const counts = childPositions.map((positions) => positions.length) as [
      number,
      number,
      number,
      number,
    ];
    return {
      ...whole,
      children: childrenWithPositions(counts, childPositions),
    };
  }

  #finishCell(
    cell: HierarchyCell,
    count: number,
    inheritedPositions: readonly Point2D[] | undefined,
    stats: MutableStats,
  ): StarfieldCellResult {
    const positions =
      inheritedPositions ??
      (count <= STAR_MATERIALIZATION_THRESHOLD
        ? this.#materialize(cell, count, stats)
        : undefined);
    return { count, positions };
  }

  #splitPopulation(
    cell: HierarchyCell,
    count: number,
    stats: MutableStats,
  ): [number, number, number, number] {
    stats.populationSplits += 1;
    const address = cellAddress('population-split', cell);
    const west = binomialHalf(this.#random, [...address, 'west'], count);
    const east = count - west;
    const southwest = binomialHalf(this.#random, [...address, 'west-south'], west);
    const southeast = binomialHalf(this.#random, [...address, 'east-south'], east);
    return [southwest, southeast, west - southwest, east - southeast];
  }

  #materialize(cell: HierarchyCell, count: number, stats: MutableStats): Point2D[] {
    stats.starsMaterialized += count;
    return Array.from({ length: count }, (_, index) => ({
      x: uniform(
        this.#random,
        [...cellAddress('position', cell), index, 'x'],
        cell.minX,
        cell.minX + cell.edgeLength,
      ),
      y: uniform(
        this.#random,
        [...cellAddress('position', cell), index, 'y'],
        cell.minY,
        cell.minY + cell.edgeLength,
      ),
    }));
  }
}

export function classifyStarPositions(
  cell: HierarchyCell,
  positions: readonly Point2D[],
): [Point2D[], Point2D[], Point2D[], Point2D[]] {
  const children: [Point2D[], Point2D[], Point2D[], Point2D[]] = [[], [], [], []];
  for (const position of positions) children[childIndexOfPoint(cell, position)].push(position);
  return children;
}

function childResults(
  counts: readonly [number, number, number, number],
): [StarfieldChildResult, StarfieldChildResult, StarfieldChildResult, StarfieldChildResult] {
  return [
    { count: counts[0] },
    { count: counts[1] },
    { count: counts[2] },
    { count: counts[3] },
  ];
}

function childrenWithPositions(
  counts: readonly [number, number, number, number],
  positions: readonly [Point2D[], Point2D[], Point2D[], Point2D[]],
): [StarfieldChildResult, StarfieldChildResult, StarfieldChildResult, StarfieldChildResult] {
  return [
    { count: counts[0], positions: positions[0] },
    { count: counts[1], positions: positions[1] },
    { count: counts[2], positions: positions[2] },
    { count: counts[3], positions: positions[3] },
  ];
}

function childIndexOf(parent: HierarchyCell, child: HierarchyCell): number {
  const half = parent.edgeLength / 2;
  const east = child.minX >= parent.minX + half;
  const north = child.minY >= parent.minY + half;
  return Number(east) + 2 * Number(north);
}

function childIndexOfPoint(parent: HierarchyCell, point: Point2D): number {
  const half = parent.edgeLength / 2;
  const east = point.x >= parent.minX + half;
  const north = point.y >= parent.minY + half;
  return Number(east) + 2 * Number(north);
}

function childAt(parent: HierarchyCell, index: number): HierarchyCell {
  const edgeLength = parent.edgeLength / 2;
  return {
    minX: parent.minX + (index % 2) * edgeLength,
    minY: parent.minY + Math.floor(index / 2) * edgeLength,
    edgeLength,
  };
}

function cellAddress(domain: string, cell: HierarchyCell) {
  return [`starfield.${domain}`, cell.minX, cell.minY, cell.edgeLength] as const;
}

function cellKey(cell: HierarchyCell): string {
  return `${cell.minX},${cell.minY},${cell.edgeLength}`;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function emptyStats(): MutableStats {
  return {
    cacheHits: 0,
    cellsEvaluated: 0,
    maximumDepth: 0,
    poissonSamples: 0,
    populationSplits: 0,
    starsMaterialized: 0,
  };
}
