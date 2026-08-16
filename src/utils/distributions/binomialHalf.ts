import binomialQuantile from '@stdlib/stats-base-dists-binomial-quantile';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { clampedStandardNormalQuantile } from './normal';
import { uniformUnit } from './uniform';

export const BINOMIAL_NORMAL_APPROXIMATION_THRESHOLD = 1_000;

/** Samples the size of one side of an even-probability split. */
export function binomialHalf(
  random: AddressedRandom,
  address: Address,
  trials: number,
): number {
  const quantile = uniformUnit(random, address);
  if (trials <= BINOMIAL_NORMAL_APPROXIMATION_THRESHOLD) {
    return binomialQuantile(quantile, trials, 0.5);
  }

  const thresholdQuantile = binomialQuantile(
    quantile,
    BINOMIAL_NORMAL_APPROXIMATION_THRESHOLD,
    0.5,
  );
  const approximateQuantile = Math.round(
    trials / 2 + Math.sqrt(trials) / 2 * clampedStandardNormalQuantile(quantile),
  );
  return Math.max(thresholdQuantile, approximateQuantile);
}
