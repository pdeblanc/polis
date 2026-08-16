import binomialQuantile from '@stdlib/stats-base-dists-binomial-quantile';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { uniformUnit } from './uniform';

/** Samples the size of one side of an even-probability split. */
export function binomialHalf(
  random: AddressedRandom,
  address: Address,
  trials: number,
): number {
  return binomialQuantile(uniformUnit(random, address), trials, 0.5);
}
