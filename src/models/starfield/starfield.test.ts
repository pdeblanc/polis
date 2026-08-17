import { describe, expect, it } from 'vitest';
import { HierarchicalStarfield } from './hierarchicalStarfield';
import { STARFIELD_MAX_TILES_PER_QUERY, Starfield } from './starfield';

describe('Starfield', () => {
  it('selects the coarsest aligned grid no coarser than requested', () => {
    const tiles = new Starfield('public-grid').queryTiles(
      { minX: -0.2, minY: -0.1, maxX: 0.6, maxY: 0.7 },
      0.3,
    );

    expect(tiles).toHaveLength(16);
    expect(
      tiles.every((tile) => tile.bounds.maxX - tile.bounds.minX === 0.25),
    ).toBe(true);
    expect(tiles[0].bounds).toEqual({ minX: -0.25, minY: -0.25, maxX: 0, maxY: 0 });
    expect(tiles.at(-1)?.bounds).toEqual({ minX: 0.5, minY: 0.5, maxX: 0.75, maxY: 0.75 });
  });

  it('returns the internal stochastic fact without exposing its hierarchy address', () => {
    const tile = new Starfield('public-result').queryTiles(
      { minX: 0.1, minY: 0.1, maxX: 0.9, maxY: 0.9 },
      1,
    )[0];
    const internal = new HierarchicalStarfield('public-result').queryCell({
      minX: 0,
      minY: 0,
      edgeLength: 1,
    });

    expect(tile).toEqual({
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      ...internal,
    });
  });

  it('keeps large-population output aggregated', () => {
    const [tile] = new Starfield('bounded-public-output').queryTiles(
      { minX: 0, minY: 0, maxX: 2 ** 16, maxY: 2 ** 16 },
      2 ** 16,
    );

    expect(tile.count).toBeGreaterThan(64);
    expect(tile.positions).toBeUndefined();
  });

  it('rejects invalid or excessively large tile requests', () => {
    const starfield = new Starfield('public-validation');
    expect(() =>
      starfield.queryTiles({ minX: 0, minY: 0, maxX: 0, maxY: 1 }, 1),
    ).toThrow(RangeError);
    expect(() =>
      starfield.queryTiles({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0),
    ).toThrow(RangeError);
    expect(() =>
      starfield.queryTiles(
        { minX: 0, minY: 0, maxX: STARFIELD_MAX_TILES_PER_QUERY + 1, maxY: 1 },
        1,
      ),
    ).toThrow(RangeError);
  });
});
