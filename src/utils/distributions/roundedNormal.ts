import normalCdf from '@stdlib/stats-base-dists-normal-cdf';
import { NORMAL_MAX_DEVIATIONS } from './normal';

export interface ProbabilityMass {
  readonly value: number;
  readonly probability: number;
}

export type ProbabilityMassTable = readonly ProbabilityMass[];

/**
 * Returns the finite probability table obtained by clamping a normal random variable
 * and then applying `Math.round`.
 *
 * Probability outside the six-standard-deviation interval belongs to the rounded clamp
 * points. This is intentionally different from conditioning the normal variable on that
 * interval.
 */
export function roundedNormal(
  mean: number,
  standardDeviation: number,
): ProbabilityMassTable {
  if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation) || standardDeviation < 0) {
    throw new RangeError('Rounded-normal parameters must be finite with nonnegative spread');
  }

  if (standardDeviation === 0) {
    return [{ value: Math.round(mean), probability: 1 }];
  }

  const lowerClamp = mean - NORMAL_MAX_DEVIATIONS * standardDeviation;
  const upperClamp = mean + NORMAL_MAX_DEVIATIONS * standardDeviation;
  const firstValue = Math.round(lowerClamp);
  const lastValue = Math.round(upperClamp);
  const lowerTail = normalCdf(lowerClamp, mean, standardDeviation);
  const upperTail = 1 - normalCdf(upperClamp, mean, standardDeviation);
  const masses: ProbabilityMass[] = [];

  for (let value = firstValue; value <= lastValue; value += 1) {
    const continuousLower = Math.max(lowerClamp, value - 0.5);
    const continuousUpper = Math.min(upperClamp, value + 0.5);
    let probability =
      continuousLower < continuousUpper
        ? normalCdf(continuousUpper, mean, standardDeviation) -
          normalCdf(continuousLower, mean, standardDeviation)
        : 0;

    if (Math.round(lowerClamp) === value) probability += lowerTail;
    if (Math.round(upperClamp) === value) probability += upperTail;
    masses.push({ value, probability });
  }

  // CDF subtraction accumulates a small floating-point error. Normalize so consumers
  // can rely on the table summing to one when it is used as a categorical kernel.
  const total = masses.reduce((sum, mass) => sum + mass.probability, 0);
  return masses.map(({ value, probability }) => ({
    value,
    probability: probability / total,
  }));
}
