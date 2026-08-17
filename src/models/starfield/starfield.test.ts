import { describe, expect, it } from 'vitest';
import type { HierarchyCell } from './hierarchy';
import {
  Starfield,
  STAR_MATERIALIZATION_THRESHOLD,
  type StarfieldCellResult,
} from './starfield';

const ROOT: HierarchyCell = { minX: 0, minY: 0, edgeLength: 1 };

describe('Starfield', () => {
  it('returns child populations that sum to their parent', () => {
    const result = new Starfield('population-sum').querySubdivision({
      minX: 0,
      minY: 0,
      edgeLength: 8,
    });

    expect(sum(result.children.map((child) => child.count))).toBe(result.count);
  });

  it('gives child queries the counts owned by their parent', () => {
    const starfield = new Starfield('child-consistency');
    const parent = starfield.querySubdivision(ROOT);
    const children = immediateChildren(ROOT).map((cell) => starfield.queryCell(cell));

    expect(children.map((child) => child.count)).toEqual(
      parent.children.map((child) => child.count),
    );
  });

  it('preserves the smaller cell during outward expansion', () => {
    const starfield = new Starfield('expansion-consistency');
    const root = starfield.queryCell(ROOT);
    const expansion = starfield.querySubdivision({ minX: 0, minY: 0, edgeLength: 2 });

    expect(expansion.children[0].count).toBe(root.count);
  });

  it('does not subdivide the requested cell for a whole-cell query', () => {
    const starfield = new Starfield('whole-cell-only');
    const cell = { minX: 8, minY: 0, edgeLength: 8 } as const;

    const whole = starfield.queryCell(cell);
    expect(starfield.getLastQueryStats().populationSplits).toBe(0);

    const subdivision = starfield.querySubdivision(cell);
    expect(subdivision.count).toBe(whole.count);
    expect(starfield.getLastQueryStats().populationSplits).toBe(1);
  });

  it('classifies materialized positions into canonical child cells', () => {
    const result = new Starfield('position-classification').querySubdivision(ROOT);

    expect(result.positions).toBeDefined();
    expect(classify(ROOT, result)).toEqual(result.children.map((child) => child.count));
    expect(result.children.every((child) => child.positions !== undefined)).toBe(true);
    expect(result.positions?.length).toBe(result.count);
    expect(result.positions?.length).toBeLessThanOrEqual(STAR_MATERIALIZATION_THRESHOLD);
  });

  it('is independent of query order and cache state', () => {
    const cell = { minX: 3, minY: -2, edgeLength: 0.25 } as const;
    const first = new Starfield('query-independence');
    const expected = first.queryCell(cell);
    first.queryCell(ROOT);
    expect(first.queryCell(cell)).toEqual(expected);

    first.clearCache();
    expect(first.queryCell(cell)).toEqual(expected);

    const reverse = new Starfield('query-independence');
    reverse.queryCell(ROOT);
    expect(reverse.queryCell(cell)).toEqual(expected);
  });

  it('records recursive work and cache hits per public query', () => {
    const starfield = new Starfield('query-stats');
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
