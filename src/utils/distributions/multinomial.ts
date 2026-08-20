import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { binomial } from './binomial';
import { profileDistribution } from './profiling';

export const MULTINOMIAL_PROBABILITY_TOLERANCE = 1e-12;

export interface MultinomialCategory {
  readonly probability: number;
  /** Semantic suffix identifying this category beneath the batch address. */
  readonly address: Address;
}

/**
 * Samples multinomial counts as sequential conditional binomials in supplied canonical
 * order. The final positive-probability category receives the exact remainder.
 */
export function multinomial(
  random: AddressedRandom,
  address: Address,
  trials: number,
  categories: readonly MultinomialCategory[],
): readonly number[] {
  return profileDistribution('multinomial', () =>
    sampleMultinomial(random, address, trials, categories),
  );
}

function sampleMultinomial(
  random: AddressedRandom,
  address: Address,
  trials: number,
  categories: readonly MultinomialCategory[],
): readonly number[] {
  if (!Number.isSafeInteger(trials) || trials < 0) {
    throw new RangeError('Multinomial trials must be a nonnegative safe integer');
  }
  if (categories.length === 0) {
    throw new RangeError('Multinomial requires at least one category');
  }

  const suffixProbabilities = new Array<number>(categories.length + 1).fill(0);
  for (let index = categories.length - 1; index >= 0; index -= 1) {
    const probability = categories[index].probability;
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError('Multinomial probabilities must be between zero and one');
    }
    suffixProbabilities[index] = probability + suffixProbabilities[index + 1];
  }

  const totalProbability = suffixProbabilities[0];
  if (Math.abs(totalProbability - 1) > MULTINOMIAL_PROBABILITY_TOLERANCE) {
    throw new RangeError('Multinomial probabilities must sum to one');
  }

  const counts = new Array<number>(categories.length).fill(0);
  let remainingTrials = trials;

  for (let index = 0; index < categories.length; index += 1) {
    const { address: categoryAddress, probability } = categories[index];
    if (probability === 0) continue;

    const remainingProbability = suffixProbabilities[index];
    const isFinalActiveCategory = suffixProbabilities[index + 1] === 0;
    if (isFinalActiveCategory) {
      counts[index] = remainingTrials;
      break;
    }

    const conditionalProbability = Math.min(1, probability / remainingProbability);
    const count = binomial(
      random,
      [...address, 'multinomial-category', ...categoryAddress],
      remainingTrials,
      conditionalProbability,
    );
    counts[index] = count;
    remainingTrials -= count;
  }

  return counts;
}
