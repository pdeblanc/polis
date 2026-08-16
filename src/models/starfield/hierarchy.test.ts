import { describe, expect, it } from 'vitest';
import { cellContainingPoint, dependencyAncestor } from './hierarchy';

describe('starfield hierarchy', () => {
  it('finds aligned cells on either side of the origin', () => {
    expect(cellContainingPoint({ x: 0.75, y: -0.25 }, 1)).toEqual({
      minX: 0,
      minY: -1,
      edgeLength: 1,
    });
    expect(cellContainingPoint({ x: -0.25, y: 0.75 }, 1)).toEqual({
      minX: -1,
      minY: 0,
      edgeLength: 1,
    });
  });

  it('uses the positive-side cell for a point on an axis', () => {
    expect(cellContainingPoint({ x: 0, y: 0 }, 1)).toEqual({
      minX: 0,
      minY: 0,
      edgeLength: 1,
    });
  });

  it.each([
    { minX: 0, minY: 0, edgeLength: 1 },
    { minX: -1, minY: 0, edgeLength: 1 },
    { minX: 0, minY: -1, edgeLength: 1 },
    { minX: -1, minY: -1, edgeLength: 1 },
  ])('gives origin-adjacent unit root $minX,$minY no ancestor', (cell) => {
    expect(dependencyAncestor(cell)).toBeUndefined();
  });

  it('gives an origin-anchored expansion its smaller ancestor', () => {
    expect(dependencyAncestor({ minX: -4, minY: 0, edgeLength: 4 })).toEqual({
      cell: { minX: -2, minY: 0, edgeLength: 2 },
      relativeSize: 'smaller',
    });
  });

  it('gives other cells their larger ancestor', () => {
    expect(dependencyAncestor({ minX: 1, minY: 0, edgeLength: 1 })).toEqual({
      cell: { minX: 0, minY: 0, edgeLength: 2 },
      relativeSize: 'larger',
    });
    expect(dependencyAncestor({ minX: -0.75, minY: 0.25, edgeLength: 0.25 })).toEqual({
      cell: { minX: -1, minY: 0, edgeLength: 0.5 },
      relativeSize: 'larger',
    });
  });
});
