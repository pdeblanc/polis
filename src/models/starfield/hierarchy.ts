export type Point2D = {
  readonly x: number;
  readonly y: number;
};

export type HierarchyCell = {
  readonly minX: number;
  readonly minY: number;
  readonly edgeLength: number;
};

export type DependencyAncestor = {
  readonly cell: HierarchyCell;
  readonly relativeSize: 'smaller' | 'larger';
};

/** Returns the aligned hierarchy cell at `edgeLength` containing a point. */
export function cellContainingPoint(
  point: Point2D,
  edgeLength: number,
): HierarchyCell {
  return {
    minX: Math.floor(point.x / edgeLength) * edgeLength,
    minY: Math.floor(point.y / edgeLength) * edgeLength,
    edgeLength,
  };
}

/**
 * Returns the cell that must be queried immediately before this cell.
 *
 * Unit cells touching the origin are roots. Larger origin-anchored cells depend on
 * the smaller origin-anchored cell they expand. Every other cell inherits its count
 * from its larger geometric parent.
 */
export function dependencyAncestor(cell: HierarchyCell): DependencyAncestor | undefined {
  const originAnchored = hasOriginCorner(cell);

  if (cell.edgeLength === 1 && originAnchored) return undefined;

  if (cell.edgeLength > 1 && originAnchored) {
    const edgeLength = cell.edgeLength / 2;
    return {
      cell: {
        minX: cell.minX === 0 ? 0 : -edgeLength,
        minY: cell.minY === 0 ? 0 : -edgeLength,
        edgeLength,
      },
      relativeSize: 'smaller',
    };
  }

  return {
    cell: cellContainingPoint(
      { x: cell.minX, y: cell.minY },
      cell.edgeLength * 2,
    ),
    relativeSize: 'larger',
  };
}

function hasOriginCorner(cell: HierarchyCell): boolean {
  const { edgeLength, minX, minY } = cell;
  return (minX === 0 || minX === -edgeLength) && (minY === 0 || minY === -edgeLength);
}
