import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { poisson, POISSON_UPPER_TAIL_PROBABILITY } from './poisson';

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
    const random = fixedRandom(0xd70a_3d70_a3d7_0000n);
    const means = [0, 0.01, 0.1, 1, 10, 100, 1_000];
    const samples = means.map((mean) => poisson(random, ['population'], mean));

    expect(samples).toEqual([...samples].sort((left, right) => left - right));
  });
});
