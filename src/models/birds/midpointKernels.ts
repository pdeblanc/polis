import {
  roundedNormal,
  type ProbabilityMassTable,
} from '../../utils/distributions/roundedNormal';

export type MidpointAlignment = 'mid-cell' | 'cell-boundary';
export type NormalizedDuration = 1 | 0.5;

export interface MidpointKernelPair {
  readonly midCell: ProbabilityMassTable;
  readonly cellBoundary: ProbabilityMassTable;
}

export type MidpointKernels = Readonly<{
  [duration in NormalizedDuration]: MidpointKernelPair;
}>;

/** Builds the four scale-independent midpoint kernels for one diffusion rate. */
export function createMidpointKernels(diffusionRate: number): MidpointKernels {
  if (!Number.isFinite(diffusionRate) || diffusionRate < 0) {
    throw new RangeError('Diffusion rate must be a finite nonnegative number');
  }

  return {
    1: createKernelPair(diffusionRate, 1),
    0.5: createKernelPair(diffusionRate, 0.5),
  };
}

/** Selects one of the four canonical kernels. */
export function getMidpointKernel(
  kernels: MidpointKernels,
  normalizedDuration: NormalizedDuration,
  alignment: MidpointAlignment,
): ProbabilityMassTable {
  const pair = kernels[normalizedDuration];
  return alignment === 'mid-cell' ? pair.midCell : pair.cellBoundary;
}

/**
 * Selects a kernel from endpoint-index parity and translates it into source-relative
 * midpoint-cell offsets for a particular flow.
 */
export function midpointKernelForFlow(
  kernels: MidpointKernels,
  flowOffset: number,
  normalizedDuration: NormalizedDuration,
): ProbabilityMassTable {
  if (!Number.isSafeInteger(flowOffset)) {
    throw new RangeError('Flow offset must be a safe integer');
  }

  const alignment: MidpointAlignment = flowOffset % 2 === 0 ? 'mid-cell' : 'cell-boundary';
  const translation = Math.floor(flowOffset / 2);
  return getMidpointKernel(kernels, normalizedDuration, alignment).map(
    ({ value, probability }) => ({ value: value + translation, probability }),
  );
}

function createKernelPair(
  diffusionRate: number,
  normalizedDuration: NormalizedDuration,
): MidpointKernelPair {
  if (diffusionRate === 0) {
    return {
      midCell: [{ value: 0, probability: 1 }],
      // This is the D -> 0+ limit. Calling roundedNormal(0.5, 0) would instead apply
      // Math.round and put the entire mass in the cell on the positive side.
      cellBoundary: [
        { value: 0, probability: 0.5 },
        { value: 1, probability: 0.5 },
      ],
    };
  }

  const standardDeviation = Math.sqrt((diffusionRate * normalizedDuration) / 4);
  return {
    midCell: roundedNormal(0, standardDeviation),
    cellBoundary: roundedNormal(0.5, standardDeviation),
  };
}
