import { describe, expect, it } from 'vitest';
import { brownianIntervalTransitionProbability } from './brownian';

describe('brownianIntervalTransitionProbability', () => {
  it('uses exact overlap for zero displacement variance', () => {
    expect(brownianIntervalTransitionProbability({ min: 0, max: 2 }, { min: 1, max: 3 }, 1, 0))
      .toBe(0.5);
    expect(brownianIntervalTransitionProbability({ min: 0, max: 2 }, { min: 2, max: 3 }, 0, 4))
      .toBe(0);
  });

  it('is reflection symmetric', () => {
    const right = brownianIntervalTransitionProbability(
      { min: 0, max: 1 },
      { min: 2, max: 3 },
      2,
      0.5,
    );
    const left = brownianIntervalTransitionProbability(
      { min: -1, max: 0 },
      { min: -3, max: -2 },
      2,
      0.5,
    );
    expect(left).toBeCloseTo(right, 14);
  });

  it('sums to one over a sufficiently wide destination partition', () => {
    let total = 0;
    for (let index = -12; index < 13; index += 1) {
      total += brownianIntervalTransitionProbability(
        { min: 0, max: 1 },
        { min: index, max: index + 1 },
        1,
        1,
      );
    }
    expect(total).toBeCloseTo(1, 12);
  });

  it('rejects invalid parameters', () => {
    expect(() =>
      brownianIntervalTransitionProbability({ min: 1, max: 0 }, { min: 0, max: 1 }, 1, 1),
    ).toThrow(RangeError);
    expect(() =>
      brownianIntervalTransitionProbability({ min: 0, max: 1 }, { min: 0, max: 1 }, -1, 1),
    ).toThrow(RangeError);
  });
});
