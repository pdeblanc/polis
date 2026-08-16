import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { binomialHalf } from './binomialHalf';

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
});
