import binomialQuantile from '@stdlib/stats-base-dists-binomial-quantile';
import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { uniformUnit } from './uniform';

/** Samples an exact binomial count using one addressed inverse-CDF quantile. */
export function binomial(
  random: AddressedRandom,
  address: Address,
  trials: number,
  probability: number,
): number {
  if (!Number.isSafeInteger(trials) || trials < 0) {
    throw new RangeError('Binomial trials must be a nonnegative safe integer');
  }
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('Binomial probability must be between zero and one');
  }

  // Deterministic categories in a sequential multinomial must not consume an address.
  if (trials === 0 || probability === 0) return 0;
  if (probability === 1) return trials;

  return binomialQuantile(uniformUnit(random, address), trials, probability);
}
