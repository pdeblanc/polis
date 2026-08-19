import type { Address } from '../rng/address';
import type { AddressedRandom } from '../rng/addressedRandom';
import { uniformUnit } from './uniform';

export const HYPERGEOMETRIC_MAX_REJECTION_ATTEMPTS = 1_024;

const LOG_SQRT_TWO_PI = 0.9189385332046727;
const INVERSE_TRANSFORM_THRESHOLD = 10;

/**
 * Experimental addressed H2PE hypergeometric sampler.
 *
 * This is a TypeScript adaptation of the rejection algorithm in `rand_distr`
 * (https://github.com/rust-random/rand_distr/blob/master/src/hypergeometric.rs),
 * itself based on Kachitvichyanukul and Schmeiser (1985). It is deliberately not
 * yet the production Birds sampler: the prototype exists to measure large-count
 * throughput and numerical behavior first.
 */
export function hypergeometricPrototype(
  random: AddressedRandom,
  address: Address,
  population: number,
  subpopulation: number,
  draws: number,
): number {
  assertParameters(population, subpopulation, draws);

  if (draws === 0 || subpopulation === 0) return 0;
  if (subpopulation === population) return draws;
  if (draws === population) return subpopulation;

  let sign = 1;
  let offset = 0;
  let n1 = subpopulation;
  let n2 = population - subpopulation;

  if (n1 > n2) {
    [n1, n2] = [n2, n1];
    sign = -1;
    offset = draws;
  }

  let sampleSize = draws;
  if (sampleSize > Math.floor(population / 2)) {
    offset += sign * n1;
    sign *= -1;
    sampleSize = population - sampleSize;
  }

  const mode = Math.floor(
    ((sampleSize + 1) * (n1 + 1)) / (population + 2),
  );
  const lower = Math.max(0, sampleSize - n2);
  const reducedSample =
    mode - lower < INVERSE_TRANSFORM_THRESHOLD
      ? sampleSmallSupport(random, address, population, n1, sampleSize)
      : sampleH2pe(random, address, population, n1, n2, sampleSize, mode);

  return offset + sign * reducedSample;
}

function sampleSmallSupport(
  random: AddressedRandom,
  address: Address,
  population: number,
  subpopulation: number,
  draws: number,
): number {
  // Processing whichever set is smaller avoids factorial initialization and is
  // exact, while keeping this fallback cheap for the narrow-support cases that
  // select it.
  if (draws <= subpopulation) {
    let remainingPopulation = population;
    let remainingSubpopulation = subpopulation;
    let selected = 0;
    for (let index = 0; index < draws; index += 1) {
      const quantile = uniformUnit(random, [...address, 'direct', index]);
      if (quantile < remainingSubpopulation / remainingPopulation) {
        selected += 1;
        remainingSubpopulation -= 1;
      }
      remainingPopulation -= 1;
    }
    return selected;
  }

  let remainingPopulation = population;
  let remainingDraws = draws;
  let selected = 0;
  for (let index = 0; index < subpopulation; index += 1) {
    const quantile = uniformUnit(random, [...address, 'direct', index]);
    if (quantile < remainingDraws / remainingPopulation) {
      selected += 1;
      remainingDraws -= 1;
    }
    remainingPopulation -= 1;
  }
  return selected;
}

function sampleH2pe(
  random: AddressedRandom,
  address: Address,
  population: number,
  n1: number,
  n2: number,
  sampleSize: number,
  mode: number,
): number {
  const logModeDenominator =
    logFactorial(mode) +
    logFactorial(n1 - mode) +
    logFactorial(sampleSize - mode) +
    logFactorial(n2 - sampleSize + mode);
  const spread =
    1.5 *
      Math.sqrt(
        ((population - sampleSize) * sampleSize * n1 * n2) /
          ((population - 1) * population * population),
      ) +
    0.5;
  const left = mode - spread + 0.5;
  const right = mode + spread + 0.5;
  const leftHeight = Math.exp(
    logModeDenominator -
      logFactorial(left) -
      logFactorial(n1 - left) -
      logFactorial(sampleSize - left) -
      logFactorial(n2 - sampleSize + left),
  );
  const rightHeight = Math.exp(
    logModeDenominator -
      logFactorial(right - 1) -
      logFactorial(n1 - right + 1) -
      logFactorial(sampleSize - right + 1) -
      logFactorial(n2 - sampleSize + right - 1),
  );
  const leftRate = -Math.log(
    (left * (n2 - sampleSize + left)) /
      ((n1 - left + 1) * (sampleSize - left + 1)),
  );
  const rightRate = -Math.log(
    ((n1 - right + 1) * (sampleSize - right + 1)) /
      (right * (n2 - sampleSize + right)),
  );
  const centralArea = 2 * spread;
  const leftArea = centralArea + leftHeight / leftRate;
  const totalArea = leftArea + rightHeight / rightRate;
  const upper = Math.min(n1, sampleSize);
  const lower = Math.max(0, sampleSize - n2);

  for (let attempt = 0; attempt < HYPERGEOMETRIC_MAX_REJECTION_ATTEMPTS; attempt += 1) {
    const u = totalArea * uniformUnit(random, [...address, 'h2pe', attempt, 'region']);
    let v = uniformUnit(random, [...address, 'h2pe', attempt, 'accept']);
    let candidate: number;

    if (u <= centralArea) {
      candidate = Math.floor(left + u);
    } else if (u <= leftArea) {
      candidate = Math.floor(left + Math.log(v) / leftRate);
      if (candidate < lower) continue;
      v *= (u - centralArea) * leftRate;
    } else {
      candidate = Math.floor(right - Math.log(v) / rightRate);
      if (candidate > upper) continue;
      v *= (u - leftArea) * rightRate;
    }

    if (acceptCandidate(v, candidate, mode, n1, n2, sampleSize, logModeDenominator)) {
      return candidate;
    }
  }

  throw new Error('Hypergeometric rejection sampler exceeded its attempt limit');
}

function acceptCandidate(
  scaledUniform: number,
  candidate: number,
  mode: number,
  n1: number,
  n2: number,
  sampleSize: number,
  logModeDenominator: number,
): boolean {
  if (mode < 100 || candidate <= 50) {
    let relativeMass = 1;
    if (mode < candidate) {
      for (let index = mode + 1; index <= candidate; index += 1) {
        relativeMass *=
          ((n1 - index + 1) * (sampleSize - index + 1)) /
          (index * (n2 - sampleSize + index));
      }
    } else {
      for (let index = candidate + 1; index <= mode; index += 1) {
        relativeMass *=
          (index * (n2 - sampleSize + index)) /
          ((n1 - index + 1) * (sampleSize - index + 1));
      }
    }
    return scaledUniform <= relativeMass;
  }

  const x = candidate;
  const x1 = x + 1;
  const difference = x - mode;
  const n1Remaining = n1 - x + 1;
  const sampleRemaining = sampleSize - x + 1;
  const n2Selected = n2 - sampleSize + x1;
  const r = -difference / x1;
  const s = difference / n1Remaining;
  const t = difference / sampleRemaining;
  const e = -difference / n2Selected;
  const g = (n1Remaining * sampleRemaining) / (x1 * n2Selected) - 1;
  const divisorG = g >= 0 ? 1 : 1 + g;
  const upperG = g * (1 + g * (-0.5 + g / 3));
  const lowerG = upperG - g ** 4 / (4 * divisorG);
  const modeMidpoint = mode + 0.5;
  const n1Midpoint = n1 - mode + 0.5;
  const sampleMidpoint = sampleSize - mode + 0.5;
  const n2Midpoint = n2 - sampleSize + modeMidpoint;
  const upperBound =
    modeMidpoint * r * (1 + r * (-0.5 + r / 3)) +
    n1Midpoint * s * (1 + s * (-0.5 + s / 3)) +
    sampleMidpoint * t * (1 + t * (-0.5 + t / 3)) +
    n2Midpoint * e * (1 + e * (-0.5 + e / 3)) +
    x * upperG -
    mode * lowerG +
    0.0034;
  const logUniform = Math.log(scaledUniform);
  if (logUniform > upperBound) return false;

  const errorBound =
    fourthOrderError(modeMidpoint, r) +
    fourthOrderError(n1Midpoint, s) +
    fourthOrderError(sampleMidpoint, t) +
    fourthOrderError(n2Midpoint, e);
  if (
    logUniform <
    upperBound - 0.25 * errorBound + (x + mode) * (lowerG - upperG) - 0.0078
  ) {
    return true;
  }

  return (
    logUniform <=
    logModeDenominator -
      logFactorial(x) -
      logFactorial(n1 - x) -
      logFactorial(sampleSize - x) -
      logFactorial(n2 - sampleSize + x)
  );
}

function fourthOrderError(coefficient: number, ratio: number): number {
  const numerator = coefficient * ratio ** 4;
  return ratio < 0 ? numerator / (1 + ratio) : numerator;
}

function logFactorial(value: number): number {
  const shifted = value + 3;
  return (
    (shifted + 0.5) * Math.log(shifted) -
    shifted +
    LOG_SQRT_TWO_PI +
    1 / (12 * shifted) -
    Math.log((value + 3) * (value + 2) * (value + 1))
  );
}

function assertParameters(population: number, subpopulation: number, draws: number): void {
  if (
    !Number.isSafeInteger(population) ||
    !Number.isSafeInteger(subpopulation) ||
    !Number.isSafeInteger(draws) ||
    population < 0 ||
    subpopulation < 0 ||
    subpopulation > population ||
    draws < 0 ||
    draws > population
  ) {
    throw new RangeError(
      'Hypergeometric parameters must be feasible nonnegative safe integers',
    );
  }
}
