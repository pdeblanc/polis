import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import {
  poisson,
  POISSON_NORMAL_APPROXIMATION_THRESHOLD,
  POISSON_UPPER_TAIL_PROBABILITY,
} from './poisson';

function fixedRandom(bits: bigint, addresses?: Address[]): AddressedRandom {
  return {
    randomU64(address) {
      addresses?.push(address);
      return bits;
    },
  };
}

describe('poisson', () => {
  it('samples the quantile at the caller address', () => {
    const addresses: Address[] = [];

    expect(poisson(fixedRandom(1n << 63n, addresses), ['population'], 10)).toBe(10);
    expect(addresses).toEqual([['population']]);
  });

  it('clamps the upper tail', () => {
    expect(POISSON_UPPER_TAIL_PROBABILITY).toBe(2 ** -32);
    expect(poisson(fixedRandom((1n << 64n) - 1n), ['population'], 1)).toBe(12);
  });

  it('is monotone in the mean for a fixed quantile', () => {
    const quantiles = [0n, 1n << 48n, 1n << 62n, 1n << 63n, 3n << 62n, (1n << 64n) - 1n];
    const means = [0, 0.01, 1, 100, 999, 1_000, 1_001, 1_010, 10_000, 1e9];

    for (const bits of quantiles) {
      const samples = means.map((mean) => poisson(fixedRandom(bits), ['population'], mean));
      expect(samples).toEqual([...samples].sort((left, right) => left - right));
    }
  });

  it('uses a rounded normal approximation above the threshold', () => {
    const addresses: Address[] = [];

    expect(POISSON_NORMAL_APPROXIMATION_THRESHOLD).toBe(1_000);
    expect(poisson(fixedRandom(1n << 63n, addresses), ['population'], 1e9)).toBe(1e9);
    expect(addresses).toEqual([['population']]);
  });

  it('approximately preserves large-mean moments', () => {
    const sampleCount = 8_192;
    const mean = 1_000_000;
    const samples = Array.from({ length: sampleCount }, (_, index) =>
      poisson(fixedRandom((BigInt(index) << 64n) / BigInt(sampleCount) + (1n << 50n)), ['p'], mean),
    );
    const sampleMean = samples.reduce((sum, value) => sum + value, 0) / sampleCount;
    const sampleVariance = samples.reduce((sum, value) => sum + (value - sampleMean) ** 2, 0) / sampleCount;

    expect(sampleMean).toBeCloseTo(mean, -1);
    expect(sampleVariance).toBeGreaterThan(mean * 0.97);
    expect(sampleVariance).toBeLessThan(mean * 1.03);
  });
});
