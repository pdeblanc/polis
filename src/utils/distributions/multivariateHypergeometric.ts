import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { hypergeometric } from './hypergeometric';
import { profileDistribution } from './profiling';

export interface HypergeometricCategory {
  readonly capacity: number;
  /** Semantic suffix identifying this category beneath the batch address. */
  readonly address: Address;
}

/** Samples category counts without replacement in supplied canonical order. */
export function multivariateHypergeometric(
  random: AddressedRandom,
  address: Address,
  categories: readonly HypergeometricCategory[],
  sampleSize: number,
): readonly number[] {
  return profileDistribution('multivariateHypergeometric', () =>
    sampleMultivariateHypergeometric(random, address, categories, sampleSize),
  );
}

function sampleMultivariateHypergeometric(
  random: AddressedRandom,
  address: Address,
  categories: readonly HypergeometricCategory[],
  sampleSize: number,
): readonly number[] {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0) {
    throw new RangeError('Hypergeometric sample size must be a nonnegative safe integer');
  }
  if (categories.length === 0) {
    throw new RangeError('Multivariate hypergeometric requires at least one category');
  }

  let totalCapacity = 0;
  for (const { capacity } of categories) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError('Hypergeometric capacities must be nonnegative safe integers');
    }
    totalCapacity += capacity;
    if (!Number.isSafeInteger(totalCapacity)) {
      throw new RangeError('Total hypergeometric capacity must be a safe integer');
    }
  }
  if (sampleSize > totalCapacity) {
    throw new RangeError('Hypergeometric sample size cannot exceed total capacity');
  }

  const counts = new Array<number>(categories.length).fill(0);
  let remainingCapacity = totalCapacity;
  let remainingSample = sampleSize;

  for (let index = 0; index < categories.length; index += 1) {
    const { address: categoryAddress, capacity } = categories[index];
    if (capacity === 0) continue;

    const isFinalActiveCategory = remainingCapacity === capacity;
    if (isFinalActiveCategory) {
      counts[index] = remainingSample;
      break;
    }

    const count = hypergeometric(
      random,
      [...address, 'hypergeometric-category', ...categoryAddress],
      remainingCapacity,
      capacity,
      remainingSample,
    );
    counts[index] = count;
    remainingCapacity -= capacity;
    remainingSample -= count;
  }

  return counts;
}
