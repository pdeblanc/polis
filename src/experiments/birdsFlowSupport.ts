import {
  createMidpointKernels,
  midpointKernelForFlow,
  type MidpointKernels,
  type NormalizedDuration,
} from '../models/birds/midpointKernels';
import { roundedNormal } from '../utils/distributions/roundedNormal';

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
  const midpointKernels = createMidpointKernels(diffusionRate);
  let epochOffsets = new Set(coarseOffsets);
  let iterations = 0;

  while (true) {
    const next = new Set(epochOffsets);
    for (const parentOffset of epochOffsets) {
      for (const quarterOffset of possibleQuarterFlowOffsetsWithKernels(
        parentOffset,
        midpointKernels,
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
  return possibleQuarterFlowOffsetsWithKernels(
    parentOffset,
    createMidpointKernels(diffusionRate),
  );
}

function possibleQuarterFlowOffsetsWithKernels(
  parentOffset: number,
  midpointKernels: MidpointKernels,
): ReadonlySet<number> {
  const result = new Set<number>();

  for (const midpointOffset of midpointOffsetsWithKernels(parentOffset, 1, midpointKernels)) {
    for (const firstQuarterPoint of midpointOffsetsWithKernels(
      midpointOffset,
      0.5,
      midpointKernels,
    )) {
      result.add(firstQuarterPoint);
      result.add(midpointOffset - firstQuarterPoint);
    }

    const secondHalfOffset = parentOffset - midpointOffset;
    for (const secondHalfQuarterOffset of midpointOffsetsWithKernels(
      secondHalfOffset,
      0.5,
      midpointKernels,
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
  normalizedDuration: NormalizedDuration,
): ReadonlySet<number> {
  return midpointOffsetsWithKernels(
    flowOffset,
    normalizedDuration,
    createMidpointKernels(diffusionRate),
  );
}

function midpointOffsetsWithKernels(
  flowOffset: number,
  normalizedDuration: NormalizedDuration,
  midpointKernels: MidpointKernels,
): ReadonlySet<number> {
  return new Set(
    midpointKernelForFlow(midpointKernels, flowOffset, normalizedDuration).map(
      ({ value }) => value,
    ),
  );
}

/** Returns every integer bin with positive mass under the clamped rounded normal. */
export function roundedNormalSupport(
  mean: number,
  standardDeviation: number,
): ReadonlySet<number> {
  return new Set(roundedNormal(mean, standardDeviation).map(({ value }) => value));
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
