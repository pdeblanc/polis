import normalQuantile from '@stdlib/stats-base-dists-normal-quantile';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { uniformUnit } from './uniform';

export const NORMAL_MAX_DEVIATIONS = 6;

// Standard normal probability below -6, used to clamp both tails symmetrically.
const NORMAL_TAIL_PROBABILITY = 9.865876450376946e-10;

/** Maps a unit quantile to a standard normal value, clamped at six deviations. */
export function clampedStandardNormalQuantile(quantile: number): number {
  const clampedQuantile = Math.min(
    Math.max(quantile, NORMAL_TAIL_PROBABILITY),
    1 - NORMAL_TAIL_PROBABILITY,
  );
  return normalQuantile(clampedQuantile, 0, 1);
}

/** Samples a normal value clamped at six standard deviations from its mean. */
export function normal(
  random: AddressedRandom,
  address: Address,
  mean: number,
  standardDeviation: number,
): number {
  return mean + standardDeviation * clampedStandardNormalQuantile(uniformUnit(random, address));
}
