import { describe, expect, it } from 'vitest';
import type { HierarchyCell } from './hierarchy';
import {
  HierarchicalStarfield,
  classifyStarPositions,
  STAR_MATERIALIZATION_THRESHOLD,
  type StarfieldCellResult,
} from './hierarchicalStarfield';

const ROOT: HierarchyCell = { minX: 0, minY: 0, edgeLength: 1 };

describe('HierarchicalStarfield', () => {
  it('returns child populations that sum to their parent', () => {
    const result = new HierarchicalStarfield('population-sum').querySubdivision({
      minX: 0,
      minY: 0,
      edgeLength: 8,
    });

    expect(sum(result.children.map((child) => child.count))).toBe(result.count);
  });

  it('gives child queries the counts owned by their parent', () => {
    const starfield = new HierarchicalStarfield('child-consistency');
    const parent = starfield.querySubdivision(ROOT);
    const children = immediateChildren(ROOT).map((cell) => starfield.queryCell(cell));

    expect(children.map((child) => child.count)).toEqual(
      parent.children.map((child) => child.count),
    );
  });

  it('preserves the smaller cell during outward expansion', () => {
    const starfield = new HierarchicalStarfield('expansion-consistency');
    const root = starfield.queryCell(ROOT);
    const expansion = starfield.querySubdivision({ minX: 0, minY: 0, edgeLength: 2 });

    expect(expansion.children[0].count).toBe(root.count);
  });

  it('does not subdivide the requested cell for a whole-cell query', () => {
    const starfield = new HierarchicalStarfield('whole-cell-only');
    const cell = { minX: 8, minY: 0, edgeLength: 8 } as const;

    const whole = starfield.queryCell(cell);
    expect(starfield.getLastQueryStats().populationSplits).toBe(0);

    const subdivision = starfield.querySubdivision(cell);
    expect(subdivision.count).toBe(whole.count);
    expect(starfield.getLastQueryStats().populationSplits).toBe(1);
  });

  it('classifies materialized positions into canonical child cells', () => {
    const result = new HierarchicalStarfield('position-classification').querySubdivision(ROOT);

    expect(result.positions).toBeDefined();
    expect(classify(ROOT, result)).toEqual(result.children.map((child) => child.count));
    expect(result.children.every((child) => child.positions !== undefined)).toBe(true);
    expect(result.positions?.length).toBe(result.count);
    expect(result.positions?.length).toBeLessThanOrEqual(STAR_MATERIALIZATION_THRESHOLD);
  });

  it('recovers identical positions through overlapping query strategies', () => {
    const child = immediateChildren(ROOT)[3];
    const parentFirst = new HierarchicalStarfield('overlapping-positions');
    const expected = parentFirst.querySubdivision(ROOT).children[3];
    expect(parentFirst.queryCell(child)).toEqual(expected);

    const childFirst = new HierarchicalStarfield('overlapping-positions');
    expect(childFirst.queryCell(child)).toEqual(expected);
    childFirst.clearCache();
    expect(childFirst.queryCell(child)).toEqual(expected);
  });

  it('preserves materialized positions in the existing expansion child', () => {
    const starfield = new HierarchicalStarfield('expansion-position-preservation');
    const root = starfield.queryCell(ROOT);
    const expansion = starfield.querySubdivision({ minX: 0, minY: 0, edgeLength: 2 });

    expect(expansion.positions).toBeDefined();
    expect(expansion.children[0].positions).toEqual(root.positions);
  });

  it('materializes only threshold-sized populations and keeps positions in bounds', () => {
    const starfield = new HierarchicalStarfield('materialization-rule');
    const small = starfield.queryCell(ROOT);
    const large = starfield.queryCell({ minX: 0, minY: 0, edgeLength: 16 });

    expect(small.count).toBeLessThanOrEqual(STAR_MATERIALIZATION_THRESHOLD);
    expect(small.positions).toHaveLength(small.count);
    expect(
      small.positions?.every(
        (position) =>
          position.x >= ROOT.minX &&
          position.x <= ROOT.minX + ROOT.edgeLength &&
          position.y >= ROOT.minY &&
          position.y <= ROOT.minY + ROOT.edgeLength,
      ),
    ).toBe(true);
    expect(large.count).toBeGreaterThan(STAR_MATERIALIZATION_THRESHOLD);
    expect(large.positions).toBeUndefined();
  });

  it('uses east and north children for positions exactly on subdivision boundaries', () => {
    const positions = [
      { x: 0.5, y: 0.25 },
      { x: 0.25, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];

    expect(classifyStarPositions(ROOT, positions)).toEqual([
      [],
      [positions[0]],
      [positions[1]],
      [positions[2]],
    ]);
  });

  it('is unchanged by LRU eviction and stays within configured capacities', () => {
    const starfield = new HierarchicalStarfield('eviction-independence', {
      cellCacheCapacity: 2,
      subdivisionCacheCapacity: 2,
    });
    const expected = starfield.queryCell(ROOT);
    starfield.queryCell({ minX: -1, minY: 0, edgeLength: 1 });
    starfield.queryCell({ minX: 0, minY: -1, edgeLength: 1 });
    starfield.queryCell({ minX: -1, minY: -1, edgeLength: 1 });

    expect(starfield.getCacheUsage().entries).toBeLessThanOrEqual(4);
    expect(starfield.queryCell(ROOT)).toEqual(expected);
    expect(starfield.getLastQueryStats().cellsEvaluated).toBeGreaterThan(0);
  });

  it('is independent of query order and cache state', () => {
    const cell = { minX: 3, minY: -2, edgeLength: 0.25 } as const;
    const first = new HierarchicalStarfield('query-independence');
    const expected = first.queryCell(cell);
    first.queryCell(ROOT);
    expect(first.queryCell(cell)).toEqual(expected);

    first.clearCache();
    expect(first.queryCell(cell)).toEqual(expected);

    const reverse = new HierarchicalStarfield('query-independence');
    reverse.queryCell(ROOT);
    expect(reverse.queryCell(cell)).toEqual(expected);
  });

  it('records recursive work and cache hits per public query', () => {
    const starfield = new HierarchicalStarfield('query-stats');
    const cell = { minX: 3, minY: 0, edgeLength: 0.25 } as const;
    starfield.queryCell(cell);
    const cold = starfield.getLastQueryStats();
    expect(cold.cellsEvaluated).toBeGreaterThan(1);
    expect(cold.maximumDepth).toBeGreaterThan(0);
    expect(starfield.getCacheUsage()).toMatchObject({
      capacity: 40_000,
      entries: expect.any(Number),
    });
    expect(starfield.getCacheUsage().entries).toBeGreaterThan(0);

    starfield.queryCell(cell);
    expect(starfield.getLastQueryStats()).toMatchObject({
      cacheHits: 1,
      cellsEvaluated: 0,
      maximumDepth: 0,
    });
  });
});

function immediateChildren(cell: HierarchyCell): HierarchyCell[] {
  const half = cell.edgeLength / 2;
  return [
    { minX: cell.minX, minY: cell.minY, edgeLength: half },
    { minX: cell.minX + half, minY: cell.minY, edgeLength: half },
    { minX: cell.minX, minY: cell.minY + half, edgeLength: half },
    { minX: cell.minX + half, minY: cell.minY + half, edgeLength: half },
  ];
}

function classify(cell: HierarchyCell, result: StarfieldCellResult): number[] {
  const counts = [0, 0, 0, 0];
  const half = cell.edgeLength / 2;
  for (const position of result.positions ?? []) {
    const east = position.x >= cell.minX + half;
    const north = position.y >= cell.minY + half;
    counts[Number(east) + 2 * Number(north)] += 1;
  }
  return counts;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
