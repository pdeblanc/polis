import {
  constructBirdsMotionSupport,
  midpointOffsets,
  possibleQuarterFlowOffsets,
} from '../models/birds/motionSupport';

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
  const support = constructBirdsMotionSupport(diffusionRate);
  return {
    coarseOffsets: new Set(support.coarseOffsets),
    epochOffsets: new Set(support.epochOffsets),
    iterations: support.iterations,
  };
}

export { midpointOffsets, possibleQuarterFlowOffsets };
