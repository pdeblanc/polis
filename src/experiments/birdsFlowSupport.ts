import { NORMAL_MAX_DEVIATIONS } from '../utils/distributions/normal';

export interface BirdsFlowSupport {
  readonly coarseOffsets: ReadonlySet<number>;
  readonly epochOffsets: ReadonlySet<number>;
  readonly iterations: number;
}

/**
 * Constructs the smallest epoch-offset set containing the coarse kernel and closed
 * under both temporal subdivisions and the final spatial subdivision.
 *
 * This is an executable design experiment. It intentionally works with cell indices
 * and finite rounded-normal support rather than continuous envelope approximations.
 */
export function constructBirdsFlowSupport(diffusionRate: number): BirdsFlowSupport {
  if (!Number.isFinite(diffusionRate) || diffusionRate < 0) {
    throw new RangeError('Diffusion rate must be a finite nonnegative number');
  }

  const coarseOffsets = symmetrize(
    roundedNormalSupport(0, Math.sqrt(1 / 12 + diffusionRate)),
  );
  let epochOffsets = new Set(coarseOffsets);
  let iterations = 0;

  while (true) {
    const next = new Set(epochOffsets);
    for (const parentOffset of epochOffsets) {
      for (const quarterOffset of possibleQuarterFlowOffsets(
        parentOffset,
        diffusionRate,
      )) {
        for (const childShift of [-1, 0, 1]) {
          next.add(2 * quarterOffset + childShift);
        }
      }
    }

    iterations += 1;
    if (setsEqual(next, epochOffsets)) {
      return { coarseOffsets, epochOffsets, iterations };
    }
    epochOffsets = next;
  }
}

/** Returns every quarter-duration flow offset created from one epoch flow offset. */
export function possibleQuarterFlowOffsets(
  parentOffset: number,
  diffusionRate: number,
): ReadonlySet<number> {
  const result = new Set<number>();

  for (const midpointOffset of midpointOffsets(parentOffset, diffusionRate, 1)) {
    for (const firstQuarterPoint of midpointOffsets(
      midpointOffset,
      diffusionRate,
      0.5,
    )) {
      result.add(firstQuarterPoint);
      result.add(midpointOffset - firstQuarterPoint);
    }

    const secondHalfOffset = parentOffset - midpointOffset;
    for (const secondHalfQuarterOffset of midpointOffsets(
      secondHalfOffset,
      diffusionRate,
      0.5,
    )) {
      result.add(secondHalfQuarterOffset);
      result.add(secondHalfOffset - secondHalfQuarterOffset);
    }
  }

  return result;
}

/**
 * Returns midpoint-cell offsets relative to the source cell. Integer means use the
 * mid-cell kernel; half-integer means use the cell-boundary kernel.
 */
export function midpointOffsets(
  flowOffset: number,
  diffusionRate: number,
  normalizedDuration: 1 | 0.5,
): ReadonlySet<number> {
  const mean = flowOffset / 2;
  const standardDeviation = Math.sqrt((diffusionRate * normalizedDuration) / 4);

  if (standardDeviation === 0 && !Number.isInteger(mean)) {
    const lower = Math.floor(mean);
    return new Set([lower, lower + 1]);
  }

  return roundedNormalSupport(mean, standardDeviation);
}

/** Returns every integer bin with positive mass under the clamped rounded normal. */
export function roundedNormalSupport(
  mean: number,
  standardDeviation: number,
): ReadonlySet<number> {
  if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation) || standardDeviation < 0) {
    throw new RangeError('Rounded-normal parameters must be finite with nonnegative spread');
  }

  const radius = NORMAL_MAX_DEVIATIONS * standardDeviation;
  const first = roundToPositiveInfinity(mean - radius);
  const last = roundToPositiveInfinity(mean + radius);
  const result = new Set<number>();
  for (let value = first; value <= last; value += 1) result.add(value);
  return result;
}

function roundToPositiveInfinity(value: number): number {
  return Math.floor(value + 0.5);
}

function symmetrize(values: ReadonlySet<number>): Set<number> {
  const result = new Set<number>();
  for (const value of values) {
    result.add(value);
    result.add(-value);
  }
  return result;
}

function setsEqual(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}
