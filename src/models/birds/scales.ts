export const BIRDS_COARSE_CELL_LENGTH = 16;
export const BIRDS_COARSE_FLOW_DURATION = 256;

export interface BirdsScale {
  readonly epoch: number;
  readonly cellLength: number;
  readonly flowDuration: number;
  readonly halfFlowDuration: number;
  readonly nextFlowDuration: number;
  readonly childCellLength: number;
}

/** Returns the named spatial and temporal dimensions consumed by one epoch. */
export function birdsScale(epoch: number): BirdsScale | undefined {
  if (!Number.isSafeInteger(epoch) || epoch < 0) return undefined;

  const cellLength = BIRDS_COARSE_CELL_LENGTH / 2 ** epoch;
  const flowDuration = BIRDS_COARSE_FLOW_DURATION / 4 ** epoch;
  if (
    !Number.isFinite(cellLength) ||
    cellLength <= 0 ||
    !Number.isFinite(flowDuration) ||
    flowDuration <= 0
  ) {
    return undefined;
  }

  return {
    epoch,
    cellLength,
    flowDuration,
    halfFlowDuration: flowDuration / 2,
    nextFlowDuration: flowDuration / 4,
    childCellLength: cellLength / 2,
  };
}

/** Inverts L_n = L_0 / 2^n for an exact supported binary64 scale. */
export function epochForCellLength(cellLength: number): number | undefined {
  if (!Number.isFinite(cellLength) || cellLength <= 0) return undefined;
  const epoch = Math.log2(BIRDS_COARSE_CELL_LENGTH / cellLength);
  if (!Number.isSafeInteger(epoch) || epoch < 0) return undefined;
  return birdsScale(epoch)?.cellLength === cellLength ? epoch : undefined;
}

export function isAligned(value: number, step: number): boolean {
  return Number.isFinite(value) && Number.isFinite(step) && step > 0 && Number.isInteger(value / step);
}

export function euclideanModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
