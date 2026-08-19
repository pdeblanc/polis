import normalCdf from '@stdlib/stats-base-dists-normal-cdf';
import { describe, expect, it } from 'vitest';
import { roundedNormal } from './roundedNormal';

describe('roundedNormal', () => {
  it('returns a point mass at the Math.round value when variance is zero', () => {
    expect(roundedNormal(2.5, 0)).toEqual([{ value: 3, probability: 1 }]);
    expect(roundedNormal(-2.5, 0)).toEqual([{ value: -2, probability: 1 }]);
  });

  it('integrates probability over rounding bins', () => {
    const table = roundedNormal(0, 1);
    const center = table.find(({ value }) => value === 0);

    expect(center?.probability).toBeCloseTo(normalCdf(0.5, 0, 1) - normalCdf(-0.5, 0, 1), 14);
  });

  it('clamps the tails rather than conditioning them away', () => {
    const table = roundedNormal(0, 1);

    expect(table[0]).toEqual(
      expect.objectContaining({ value: -6 }),
    );
    expect(table.at(-1)).toEqual(
      expect.objectContaining({ value: 6 }),
    );
    expect(table[0].probability).toBeCloseTo(normalCdf(-5.5, 0, 1), 14);
    expect(table.at(-1)?.probability).toBeCloseTo(1 - normalCdf(5.5, 0, 1), 14);
  });

  it('is normalized and reflection-symmetric around an integer mean', () => {
    const table = roundedNormal(4, 1.2);

    expect(table.reduce((sum, { probability }) => sum + probability, 0)).toBeCloseTo(1, 15);
    for (let index = 0; index < table.length; index += 1) {
      const reflected = table[table.length - index - 1];
      expect(table[index].value + reflected.value).toBe(8);
      expect(table[index].probability).toBeCloseTo(reflected.probability, 14);
    }
  });

  it('uses Math.round semantics when clamp atoms land on half-integers', () => {
    const table = roundedNormal(0, 1 / 12);

    expect(table.map(({ value }) => value)).toEqual([-0, 1]);
    expect(table[1].probability).toBeGreaterThan(0);
  });

  it('supports half-integer means with the expected adjacent-bin symmetry', () => {
    const table = roundedNormal(0.5, 0.2);

    expect(table.map(({ value }) => value)).toEqual([-1, 0, 1, 2]);
    expect(table[0].probability).toBeCloseTo(table[3].probability, 14);
    expect(table[1].probability).toBeCloseTo(table[2].probability, 14);
  });

  it('rejects invalid parameters', () => {
    expect(() => roundedNormal(Number.NaN, 1)).toThrow(RangeError);
    expect(() => roundedNormal(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => roundedNormal(0, -1)).toThrow(RangeError);
  });
});
