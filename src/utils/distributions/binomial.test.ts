import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import { createAddressedRandom, type AddressedRandom } from '../rng/addressedRandom';
import { binomial } from './binomial';

function fixedRandom(bits: bigint, addresses?: Address[]): AddressedRandom {
  return {
    randomU64(address) {
      addresses?.push(address);
      return bits;
    },
  };
}

describe('binomial', () => {
  it('samples one quantile at the caller address', () => {
    const addresses: Address[] = [];

    expect(binomial(fixedRandom(1n << 63n, addresses), ['split'], 10, 0.5)).toBe(5);
    expect(addresses).toEqual([['split']]);
  });

  it('does not consume randomness for deterministic results', () => {
    const addresses: Address[] = [];
    const random = fixedRandom(1n << 63n, addresses);

    expect(binomial(random, ['empty'], 0, 0.4)).toBe(0);
    expect(binomial(random, ['impossible'], 12, 0)).toBe(0);
    expect(binomial(random, ['certain'], 12, 1)).toBe(12);
    expect(addresses).toEqual([]);
  });

  it('returns values within the trial bounds at extreme quantiles', () => {
    expect(binomial(fixedRandom(0n), ['low'], 20, 0.3)).toBe(0);
    expect(binomial(fixedRandom((1n << 64n) - 1n), ['high'], 20, 0.3)).toBe(20);
  });

  it('is deterministic for a seed and address', () => {
    const first = createAddressedRandom('binomial-determinism');
    const second = createAddressedRandom('binomial-determinism');

    expect(binomial(first, ['stage-a', 4, -2], 1_000, 0.137)).toBe(
      binomial(second, ['stage-a', 4, -2], 1_000, 0.137),
    );
  });

  it('is monotone in probability for a fixed quantile', () => {
    const quantiles = [0n, 1n << 62n, 1n << 63n, 3n << 62n, (1n << 64n) - 1n];
    const probabilities = [0, 0.001, 0.1, 0.5, 0.9, 0.999, 1];

    for (const bits of quantiles) {
      const samples = probabilities.map((probability) =>
        binomial(fixedRandom(bits), ['split'], 100, probability),
      );
      expect(samples).toEqual([...samples].sort((left, right) => left - right));
    }
  });

  it('is monotone in trial count for a fixed quantile and probability', () => {
    const quantiles = [0n, 1n << 62n, 1n << 63n, 3n << 62n, (1n << 64n) - 1n];

    for (const bits of quantiles) {
      const samples = Array.from({ length: 101 }, (_, trials) =>
        binomial(fixedRandom(bits), ['split'], trials, 0.37),
      );
      expect(samples).toEqual([...samples].sort((left, right) => left - right));
    }
  });

  it('matches the expected empirical mean and variance', () => {
    const random = createAddressedRandom('binomial-moments');
    const sampleCount = 20_000;
    const trials = 40;
    const probability = 0.23;
    const samples = Array.from({ length: sampleCount }, (_, index) =>
      binomial(random, ['sample', index], trials, probability),
    );
    const sampleMean = samples.reduce((sum, value) => sum + value, 0) / sampleCount;
    const sampleVariance =
      samples.reduce((sum, value) => sum + (value - sampleMean) ** 2, 0) / sampleCount;
    const expectedMean = trials * probability;
    const expectedVariance = trials * probability * (1 - probability);

    expect(sampleMean).toBeCloseTo(expectedMean, 1);
    expect(sampleVariance).toBeGreaterThan(expectedVariance * 0.96);
    expect(sampleVariance).toBeLessThan(expectedVariance * 1.04);
  });

  it('handles tiny probabilities such as clamped kernel tails', () => {
    const random = createAddressedRandom('binomial-tiny-probability');
    const probability = 1e-9;

    for (let index = 0; index < 100; index += 1) {
      const sample = binomial(random, ['tiny-tail', index], 1_000_000, probability);
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(1_000_000);
    }
  });

  it('rejects invalid parameters without consuming randomness', () => {
    const addresses: Address[] = [];
    const random = fixedRandom(0n, addresses);

    for (const trials of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => binomial(random, ['invalid'], trials, 0.5)).toThrow(RangeError);
    }
    for (const probability of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => binomial(random, ['invalid'], 10, probability)).toThrow(RangeError);
    }
    expect(addresses).toEqual([]);
  });
});
