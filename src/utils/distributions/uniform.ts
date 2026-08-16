import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';

const RANDOM_BITS = 64n;
const SIGNIFICAND_BITS = 53n;
const UNUSED_BITS = RANDOM_BITS - SIGNIFICAND_BITS;
const UNIT_DENOMINATOR = 2 ** Number(SIGNIFICAND_BITS);

/** Returns an addressed uniform value in the half-open interval [0, 1). */
export function uniformUnit(random: AddressedRandom, address: Address): number {
  const bits = random.randomU64(address);
  return Number(bits >> UNUSED_BITS) / UNIT_DENOMINATOR;
}

/** Affinely maps an addressed unit-uniform value into the requested range. */
export function uniform(
  random: AddressedRandom,
  address: Address,
  min: number,
  max: number,
): number {
  return min + (max - min) * uniformUnit(random, address);
}
