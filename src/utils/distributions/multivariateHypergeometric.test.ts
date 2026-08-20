import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import { createAddressedRandom, type AddressedRandom } from '../rng/addressedRandom';
import { multivariateHypergeometric } from './multivariateHypergeometric';

function fixedRandom(bits: bigint, addresses?: Address[]): AddressedRandom {
  return {
    randomU64(address) {
      addresses?.push(address);
      return bits;
    },
  };
}

const CATEGORIES = [
  { capacity: 20, address: ['cell', -1] },
  { capacity: 30, address: ['cell', 0] },
  { capacity: 50, address: ['cell', 1] },
] as const;

describe('multivariateHypergeometric', () => {
  it('conserves the sample and respects every capacity', () => {
    const random = createAddressedRandom('multivariate-hypergeometric-conservation');

    for (let sampleSize = 0; sampleSize <= 100; sampleSize += 1) {
      const counts = multivariateHypergeometric(
        random,
        ['batch', sampleSize],
        CATEGORIES,
        sampleSize,
      );
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(sampleSize);
      counts.forEach((count, index) => {
        expect(Number.isSafeInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
        expect(count).toBeLessThanOrEqual(CATEGORIES[index].capacity);
      });
    }
  });

  it('addresses draws by semantic category and skips zero and final categories', () => {
    const addresses: Address[] = [];
    multivariateHypergeometric(
      fixedRandom(1n << 63n, addresses),
      ['stage-g1', 4],
      [
        { capacity: 20, address: ['destination', -2] },
        { capacity: 0, address: ['destination', -1] },
        { capacity: 30, address: ['destination', 0] },
        { capacity: 50, address: ['destination', 1] },
      ],
      40,
    );

    expect(addresses.length).toBeGreaterThanOrEqual(2);
    expect(addresses.some((entry) => entry[4] === -1)).toBe(false);
    expect(addresses.some((entry) => entry[4] === 1)).toBe(false);
    for (const entry of addresses) {
      expect(entry.slice(0, 3)).toEqual(['stage-g1', 4, 'hypergeometric-category']);
    }
  });

  it('uses no randomness for a single positive-capacity category', () => {
    const addresses: Address[] = [];
    const counts = multivariateHypergeometric(
      fixedRandom(0n, addresses),
      ['batch'],
      [
        { capacity: 0, address: ['left'] },
        { capacity: 50, address: ['center'] },
        { capacity: 0, address: ['right'] },
      ],
      23,
    );

    expect(counts).toEqual([0, 23, 0]);
    expect(addresses).toEqual([]);
  });

  it('approximately preserves marginal moments and covariance', () => {
    const random = createAddressedRandom('multivariate-hypergeometric-moments');
    const sampleCount = 20_000;
    const sampleSize = 40;
    const population = 100;
    const samples = Array.from({ length: sampleCount }, (_, index) =>
      multivariateHypergeometric(random, ['sample', index], CATEGORIES, sampleSize),
    );
    const means = CATEGORIES.map((_, category) =>
      samples.reduce((sum, counts) => sum + counts[category], 0) / sampleCount,
    );
    const variances = CATEGORIES.map(
      (_, category) =>
        samples.reduce(
          (sum, counts) => sum + (counts[category] - means[category]) ** 2,
          0,
        ) / sampleCount,
    );
    const covariance =
      samples.reduce(
        (sum, counts) => sum + (counts[0] - means[0]) * (counts[1] - means[1]),
        0,
      ) / sampleCount;
    const finitePopulationCorrection = (population - sampleSize) / (population - 1);

    for (let category = 0; category < CATEGORIES.length; category += 1) {
      const probability = CATEGORIES[category].capacity / population;
      expect(means[category]).toBeCloseTo(sampleSize * probability, 1);
      expect(variances[category]).toBeCloseTo(
        sampleSize * probability * (1 - probability) * finitePopulationCorrection,
        0,
      );
    }
    expect(covariance).toBeCloseTo(
      -sampleSize * 0.2 * 0.3 * finitePopulationCorrection,
      0,
    );
  });

  it('is deterministic for a seed and batch address', () => {
    const first = createAddressedRandom('multivariate-hypergeometric-determinism');
    const second = createAddressedRandom('multivariate-hypergeometric-determinism');

    expect(multivariateHypergeometric(first, ['batch'], CATEGORIES, 40)).toEqual(
      multivariateHypergeometric(second, ['batch'], CATEGORIES, 40),
    );
  });

  it('rejects invalid tables before drawing', () => {
    const addresses: Address[] = [];
    const random = fixedRandom(0n, addresses);

    expect(() => multivariateHypergeometric(random, ['bad'], [], 0)).toThrow(RangeError);
    expect(() =>
      multivariateHypergeometric(random, ['bad'], [{ capacity: -1, address: ['a'] }], 0),
    ).toThrow(RangeError);
    expect(() => multivariateHypergeometric(random, ['bad'], CATEGORIES, 101)).toThrow(
      RangeError,
    );
    expect(addresses).toEqual([]);
  });
});
