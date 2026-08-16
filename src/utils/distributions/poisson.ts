import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { uniformUnit } from './uniform';

export const POISSON_UPPER_TAIL_PROBABILITY = 2 ** -32;

/** Samples a Poisson count with its upper tail clamped to a fixed quantile. */
export function poisson(
  random: AddressedRandom,
  address: Address,
  mean: number,
): number {
  const quantile = Math.min(
    uniformUnit(random, address),
    1 - POISSON_UPPER_TAIL_PROBABILITY,
  );
  return poissonQuantile(quantile, mean);
}
