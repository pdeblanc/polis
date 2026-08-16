import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { normal, NORMAL_MAX_DEVIATIONS } from './normal';

function fixedRandom(bits: bigint, addresses?: Address[]): AddressedRandom {
  return {
    randomU64(address) {
      addresses?.push(address);
      return bits;
    },
  };
}

describe('normal', () => {
  it('samples the quantile at the caller address', () => {
    const addresses: Address[] = [];

    expect(normal(fixedRandom(1n << 63n, addresses), ['displacement'], 12, 3)).toBe(12);
    expect(addresses).toEqual([['displacement']]);
  });

  it('clamps both tails at six standard deviations', () => {
    const mean = 10;
    const standardDeviation = 2;

    expect(normal(fixedRandom(0n), ['low'], mean, standardDeviation)).toBeCloseTo(
      mean - NORMAL_MAX_DEVIATIONS * standardDeviation,
    );
    expect(
      normal(fixedRandom((1n << 64n) - 1n), ['high'], mean, standardDeviation),
    ).toBeCloseTo(mean + NORMAL_MAX_DEVIATIONS * standardDeviation);
  });

  it('is monotone in the mean for a fixed quantile and deviation', () => {
    const random = fixedRandom(0xd70a_3d70_a3d7_0000n);
    const means = [-100, -1, 0, 1, 100];
    const samples = means.map((mean) => normal(random, ['displacement'], mean, 3));

    expect(samples).toEqual([...samples].sort((left, right) => left - right));
  });
});
