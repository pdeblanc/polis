import { LRUCache } from 'lru-cache';
import { binomialHalf } from '../../utils/distributions/binomialHalf';
import { poisson } from '../../utils/distributions/poisson';
import { uniform } from '../../utils/distributions/uniform';
import {
  createAddressedRandom,
  type AddressedRandom,
  type Seed,
} from '../../utils/rng/addressedRandom';
import type { Point2D } from '../../utils/geometry/point2d';
import { dependencyAncestor, type HierarchyCell } from './hierarchy';

export const STAR_DENSITY = 8;
export const STAR_MATERIALIZATION_THRESHOLD = 64;
export const STARFIELD_CELL_CACHE_CAPACITY = 20_000;

export type PopulationCount = number;

export type StarfieldCellResult = {
  readonly count: PopulationCount;
  readonly childCounts: readonly [
    PopulationCount,
    PopulationCount,
    PopulationCount,
    PopulationCount,
  ];
  readonly positions?: readonly Point2D[];
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

export class Starfield {
  readonly #random: AddressedRandom;
  readonly #cache = new LRUCache<string, StarfieldCellResult>({
    max: STARFIELD_CELL_CACHE_CAPACITY,
  });
  #lastQueryStats: StarfieldQueryStats = emptyStats();

  constructor(seed: Seed) {
    this.#random = createAddressedRandom(seed);
  }

  queryCell(cell: HierarchyCell): StarfieldCellResult {
    const stats = emptyStats();
    const result = this.#queryCell(cell, stats, 0);
    this.#lastQueryStats = stats;
    return result;
  }

  getLastQueryStats(): StarfieldQueryStats {
    return this.#lastQueryStats;
  }

  clearCache(): void {
    this.#cache.clear();
  }

  #queryCell(cell: HierarchyCell, stats: MutableStats, depth: number): StarfieldCellResult {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const key = cellKey(cell);
    const cached = this.#cache.get(key);
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
      const existing = this.#queryCell(ancestor.cell, stats, depth + 1);
      const childIndex = childIndexOf(cell, ancestor.cell);
      const childCounts: [number, number, number, number] = [0, 0, 0, 0];
      childCounts[childIndex] = existing.count;
      const childArea = ancestor.cell.edgeLength ** 2;

      for (let index = 0; index < childCounts.length; index += 1) {
        if (index === childIndex) continue;
        stats.poissonSamples += 1;
        childCounts[index] = poisson(
          this.#random,
          [...cellAddress('expansion-count', cell), index],
          STAR_DENSITY * childArea,
        );
      }

      const count = childCounts.reduce((sum, childCount) => sum + childCount, 0);
      let positions: readonly Point2D[] | undefined;
      if (count <= STAR_MATERIALIZATION_THRESHOLD) {
        const collected = existing.positions === undefined ? [] : [...existing.positions];
        for (let index = 0; index < childCounts.length; index += 1) {
          if (index === childIndex) continue;
          collected.push(...this.#materialize(childAt(cell, index), childCounts[index], stats));
        }
        positions = collected;
      }
      result = { count, childCounts, positions };
    } else {
      const parent = this.#queryCell(ancestor.cell, stats, depth + 1);
      const count = parent.childCounts[childIndexOf(ancestor.cell, cell)];
      const inheritedPositions = parent.positions?.filter((position) =>
        pointBelongsToCell(position, cell),
      );
      result = this.#finishCell(cell, count, inheritedPositions, stats);
    }

    this.#cache.set(key, result);
    return result;
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
    const childCounts =
      positions === undefined
        ? this.#splitPopulation(cell, count, stats)
        : classifyPositions(cell, positions);
    return { count, childCounts, positions };
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

function classifyPositions(
  cell: HierarchyCell,
  positions: readonly Point2D[],
): [number, number, number, number] {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const position of positions) counts[childIndexOfPoint(cell, position)] += 1;
  return counts;
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

function pointBelongsToCell(point: Point2D, cell: HierarchyCell): boolean {
  return (
    point.x >= cell.minX &&
    point.x < cell.minX + cell.edgeLength &&
    point.y >= cell.minY &&
    point.y < cell.minY + cell.edgeLength
  );
}

function cellAddress(domain: string, cell: HierarchyCell) {
  return [`starfield.${domain}`, cell.minX, cell.minY, cell.edgeLength] as const;
}

function cellKey(cell: HierarchyCell): string {
  return `${cell.minX},${cell.minY},${cell.edgeLength}`;
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
