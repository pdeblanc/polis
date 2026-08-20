import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import { createAddressedRandom, type AddressedRandom } from '../rng/addressedRandom';
import { multinomial } from './multinomial';

function fixedRandom(bits: bigint, addresses?: Address[]): AddressedRandom {
  return {
    randomU64(address) {
      addresses?.push(address);
      return bits;
    },
  };
}

const THREE_CATEGORIES = [
  { probability: 0.2, address: ['cell', -1] },
  { probability: 0.3, address: ['cell', 0] },
  { probability: 0.5, address: ['cell', 1] },
] as const;

describe('multinomial', () => {
  it('conserves the trial total exactly', () => {
    const random = createAddressedRandom('multinomial-conservation');

    for (let trials = 0; trials <= 1_000; trials += 1) {
      const counts = multinomial(random, ['batch', trials], trials, THREE_CATEGORIES);
      expect(counts).toHaveLength(THREE_CATEGORIES.length);
      expect(counts.every(Number.isSafeInteger)).toBe(true);
      expect(counts.every((count) => count >= 0)).toBe(true);
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(trials);
    }
  });

  it('addresses draws by semantic category and skips zero and final categories', () => {
    const addresses: Address[] = [];
    const categories = [
      { probability: 0.2, address: ['midpoint-cell', -2] },
      { probability: 0, address: ['midpoint-cell', -1] },
      { probability: 0.3, address: ['midpoint-cell', 0] },
      { probability: 0.5, address: ['midpoint-cell', 1] },
    ] as const;

    multinomial(fixedRandom(1n << 63n, addresses), ['stage-a', 7], 100, categories);

    expect(addresses).toEqual([
      ['stage-a', 7, 'multinomial-category', 'midpoint-cell', -2],
      ['stage-a', 7, 'multinomial-category', 'midpoint-cell', 0],
    ]);
  });

  it('uses no randomness when only one category has positive probability', () => {
    const addresses: Address[] = [];
    const counts = multinomial(fixedRandom(0n, addresses), ['batch'], 27, [
      { probability: 0, address: ['left'] },
      { probability: 1, address: ['center'] },
      { probability: 0, address: ['right'] },
    ]);

    expect(counts).toEqual([0, 27, 0]);
    expect(addresses).toEqual([]);
  });

  it('is deterministic across equivalent random instances', () => {
    const first = createAddressedRandom('multinomial-determinism');
    const second = createAddressedRandom('multinomial-determinism');

    expect(multinomial(first, ['batch'], 10_000, THREE_CATEGORIES)).toEqual(
      multinomial(second, ['batch'], 10_000, THREE_CATEGORIES),
    );
  });

  it('approximately preserves marginal means, variances, and covariance', () => {
    const random = createAddressedRandom('multinomial-moments');
    const sampleCount = 20_000;
    const trials = 30;
    const samples = Array.from({ length: sampleCount }, (_, index) =>
      multinomial(random, ['sample', index], trials, THREE_CATEGORIES),
    );
    const means = THREE_CATEGORIES.map((_, category) =>
      samples.reduce((sum, counts) => sum + counts[category], 0) / sampleCount,
    );
    const variances = THREE_CATEGORIES.map(
      (_, category) =>
        samples.reduce(
          (sum, counts) => sum + (counts[category] - means[category]) ** 2,
          0,
        ) / sampleCount,
    );
    const covariance =
      samples.reduce(
        (sum, counts) =>
          sum + (counts[0] - means[0]) * (counts[1] - means[1]),
        0,
      ) / sampleCount;

    for (let category = 0; category < THREE_CATEGORIES.length; category += 1) {
      const probability = THREE_CATEGORIES[category].probability;
      expect(means[category]).toBeCloseTo(trials * probability, 1);
      expect(variances[category]).toBeCloseTo(trials * probability * (1 - probability), 0);
    }
    expect(covariance).toBeCloseTo(
      -trials * THREE_CATEGORIES[0].probability * THREE_CATEGORIES[1].probability,
      0,
    );
  });

  it('couples increasing trial totals monotonically by category', () => {
    const quantiles = [0n, 1n << 62n, 1n << 63n, 3n << 62n, (1n << 64n) - 1n];

    for (const bits of quantiles) {
      const samples = Array.from({ length: 101 }, (_, trials) =>
        multinomial(fixedRandom(bits), ['batch'], trials, THREE_CATEGORIES),
      );
      for (let category = 0; category < THREE_CATEGORIES.length; category += 1) {
        const counts = samples.map((sample) => sample[category]);
        expect(counts).toEqual([...counts].sort((left, right) => left - right));
      }
    }
  });

  it('accepts small floating-point normalization error', () => {
    const counts = multinomial(fixedRandom(1n << 63n), ['batch'], 100, [
      { probability: 0.1, address: ['a'] },
      { probability: 0.2, address: ['b'] },
      { probability: 0.7000000000000001, address: ['c'] },
    ]);

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(100);
  });

  it('rejects invalid trials and probability tables before drawing', () => {
    const addresses: Address[] = [];
    const random = fixedRandom(0n, addresses);

    expect(() => multinomial(random, ['bad'], -1, THREE_CATEGORIES)).toThrow(RangeError);
    expect(() => multinomial(random, ['bad'], 1, [])).toThrow(RangeError);
    expect(() =>
      multinomial(random, ['bad'], 1, [{ probability: Number.NaN, address: ['a'] }]),
    ).toThrow(RangeError);
    expect(() =>
      multinomial(random, ['bad'], 1, [
        { probability: 0.2, address: ['a'] },
        { probability: 0.2, address: ['b'] },
      ]),
    ).toThrow(RangeError);
    expect(addresses).toEqual([]);
  });
});
