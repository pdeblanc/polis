import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { uniform, uniformUnit } from './uniform';

function fixedRandom(bits: bigint, addresses?: Address[]): AddressedRandom {
  return {
    randomU64(address) {
      addresses?.push(address);
      return bits;
    },
  };
}

describe('uniformUnit', () => {
  it.each([
    [0n, 0],
    [1n << 63n, 0.5],
    [(1n << 64n) - 1n, 1 - 2 ** -53],
  ])('maps 0x%s to %s', (bits, expected) => {
    expect(uniformUnit(fixedRandom(bits), ['sample'])).toBe(expected);
  });

  it('uses the caller address directly', () => {
    const addresses: Address[] = [];

    uniformUnit(fixedRandom(0n, addresses), ['terrain', 12, -3.5]);

    expect(addresses).toEqual([['terrain', 12, -3.5]]);
  });
});

describe('uniform', () => {
  it('scales the same addressed quantile into the requested range', () => {
    const random = fixedRandom(1n << 63n);

    expect(uniform(random, ['sample'], 10, 20)).toBe(15);
  });

  it('returns the only value in a zero-width range', () => {
    expect(uniform(fixedRandom(0n), ['sample'], 7, 7)).toBe(7);
  });
});
