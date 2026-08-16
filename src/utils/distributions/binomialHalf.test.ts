import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { binomialHalf, BINOMIAL_NORMAL_APPROXIMATION_THRESHOLD } from './binomialHalf';

function fixedRandom(bits: bigint, addresses?: Address[]): AddressedRandom {
  return {
    randomU64(address) {
      addresses?.push(address);
      return bits;
    },
  };
}

describe('binomialHalf', () => {
  it('samples the quantile at the caller address', () => {
    const addresses: Address[] = [];

    expect(binomialHalf(fixedRandom(1n << 63n, addresses), ['split'], 10)).toBe(5);
    expect(addresses).toEqual([['split']]);
  });

  it('is bounded by the number of trials', () => {
    expect(binomialHalf(fixedRandom(0n), ['split'], 10)).toBe(0);
    expect(binomialHalf(fixedRandom((1n << 64n) - 1n), ['split'], 10)).toBe(10);
  });

  it('is monotone in the number of trials for a fixed quantile', () => {
    const quantiles = [0n, 1n << 62n, 1n << 63n, 3n << 62n, (1n << 64n) - 1n];

    for (const bits of quantiles) {
      const random = fixedRandom(bits);
      const samples = Array.from({ length: 101 }, (_, trials) =>
        binomialHalf(random, ['split'], trials),
      );
      expect(samples).toEqual([...samples].sort((left, right) => left - right));
    }
  });

  it('remains monotone across the approximation threshold', () => {
    const quantiles = [0n, 1n << 48n, 1n << 62n, 1n << 63n, 3n << 62n, (1n << 64n) - 1n];
    const trials = [998, 999, 1_000, 1_001, 1_002, 1_010, 10_000, 1_000_000_000];

    for (const bits of quantiles) {
      const samples = trials.map((count) => binomialHalf(fixedRandom(bits), ['split'], count));
      expect(samples).toEqual([...samples].sort((left, right) => left - right));
    }
  });

  it('uses a rounded normal approximation above the threshold', () => {
    const addresses: Address[] = [];

    expect(BINOMIAL_NORMAL_APPROXIMATION_THRESHOLD).toBe(1_000);
    expect(binomialHalf(fixedRandom(1n << 63n, addresses), ['split'], 1e9)).toBe(500_000_000);
    expect(addresses).toEqual([['split']]);
  });

  it('approximately preserves large-count moments', () => {
    const sampleCount = 8_192;
    const trials = 1_000_000;
    const expectedMean = trials / 2;
    const expectedVariance = trials / 4;
    const samples = Array.from({ length: sampleCount }, (_, index) =>
      binomialHalf(
        fixedRandom((BigInt(index) << 64n) / BigInt(sampleCount) + (1n << 50n)),
        ['split'],
        trials,
      ),
    );
    const sampleMean = samples.reduce((sum, value) => sum + value, 0) / sampleCount;
    const sampleVariance = samples.reduce((sum, value) => sum + (value - sampleMean) ** 2, 0) / sampleCount;

    expect(sampleMean).toBeCloseTo(expectedMean, -1);
    expect(sampleVariance).toBeGreaterThan(expectedVariance * 0.97);
    expect(sampleVariance).toBeLessThan(expectedVariance * 1.03);
  });
});
