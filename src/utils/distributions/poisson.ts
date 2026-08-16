import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { clampedStandardNormalQuantile } from './normal';
import { uniformUnit } from './uniform';

export const POISSON_UPPER_TAIL_PROBABILITY = 2 ** -32;
export const POISSON_NORMAL_APPROXIMATION_THRESHOLD = 1_000;

/** Samples a Poisson count with its upper tail clamped to a fixed quantile. */
export function poisson(
  random: AddressedRandom,
  address: Address,
  mean: number,
): number {
  const uniformQuantile = uniformUnit(random, address);
  const poissonQuantileValue = Math.min(
    uniformQuantile,
    1 - POISSON_UPPER_TAIL_PROBABILITY,
  );

  if (mean <= POISSON_NORMAL_APPROXIMATION_THRESHOLD) {
    return poissonQuantile(poissonQuantileValue, mean);
  }

  const thresholdQuantile = poissonQuantile(
    poissonQuantileValue,
    POISSON_NORMAL_APPROXIMATION_THRESHOLD,
  );
  const approximateQuantile = Math.round(
    mean + Math.sqrt(mean) * clampedStandardNormalQuantile(uniformQuantile),
  );
  return Math.max(thresholdQuantile, approximateQuantile);
}
