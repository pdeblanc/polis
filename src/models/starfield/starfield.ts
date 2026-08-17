import type { Point2D } from '../../utils/geometry/point2d';
import type { Seed } from '../../utils/rng/addressedRandom';
import {
  HierarchicalStarfield,
  type PopulationCount,
} from './hierarchicalStarfield';

export const STARFIELD_MAX_TILES_PER_QUERY = 65_536;

export type Rectangle = {
  readonly maxX: number;
  readonly maxY: number;
  readonly minX: number;
  readonly minY: number;
};

export type StarfieldTile = {
  readonly bounds: Rectangle;
  readonly count: PopulationCount;
  readonly positions?: readonly Point2D[];
};

/** Consumer-facing starfield API. Internal hierarchy addresses remain private. */
export class Starfield {
  readonly #hierarchy: HierarchicalStarfield;

  constructor(seed: Seed) {
    this.#hierarchy = new HierarchicalStarfield(seed);
  }

  queryTiles(rectangle: Rectangle, maximumEdgeLength: number): readonly StarfieldTile[] {
    validateRectangle(rectangle);
    if (!(maximumEdgeLength > 0) || !Number.isFinite(maximumEdgeLength)) {
      throw new RangeError('Maximum starfield tile edge length must be finite and positive');
    }
    const edgeLength = 2 ** Math.floor(Math.log2(maximumEdgeLength));
    if (!(edgeLength > 0) || !Number.isFinite(edgeLength)) {
      throw new RangeError('Maximum starfield tile edge length is outside the supported range');
    }
    const firstColumn = Math.floor(rectangle.minX / edgeLength);
    const finalColumn = Math.ceil(rectangle.maxX / edgeLength);
    const firstRow = Math.floor(rectangle.minY / edgeLength);
    const finalRow = Math.ceil(rectangle.maxY / edgeLength);
    if (
      !Number.isSafeInteger(firstColumn) ||
      !Number.isSafeInteger(finalColumn) ||
      !Number.isSafeInteger(firstRow) ||
      !Number.isSafeInteger(finalRow)
    ) {
      throw new RangeError('Starfield tile indices exceed exact integer precision');
    }
    const columns = finalColumn - firstColumn;
    const rows = finalRow - firstRow;
    if (columns * rows > STARFIELD_MAX_TILES_PER_QUERY) {
      throw new RangeError(`Starfield query exceeds the ${STARFIELD_MAX_TILES_PER_QUERY} tile limit`);
    }

    const tiles: StarfieldTile[] = [];
    for (let row = firstRow; row < finalRow; row += 1) {
      for (let column = firstColumn; column < finalColumn; column += 1) {
        const minX = column * edgeLength;
        const minY = row * edgeLength;
        const result = this.#hierarchy.queryCell({ minX, minY, edgeLength });
        tiles.push({
          bounds: { minX, minY, maxX: minX + edgeLength, maxY: minY + edgeLength },
          count: result.count,
          positions: result.positions,
        });
      }
    }
    return tiles;
  }

  getCacheUsage(): { readonly capacity: number; readonly entries: number } {
    return this.#hierarchy.getCacheUsage();
  }

  clearCache(): void {
    this.#hierarchy.clearCache();
  }
}

function validateRectangle(rectangle: Rectangle): void {
  if (
    !Number.isFinite(rectangle.minX) ||
    !Number.isFinite(rectangle.minY) ||
    !Number.isFinite(rectangle.maxX) ||
    !Number.isFinite(rectangle.maxY) ||
    rectangle.maxX <= rectangle.minX ||
    rectangle.maxY <= rectangle.minY
  ) {
    throw new RangeError('Starfield query rectangle must have finite, increasing bounds');
  }
}
