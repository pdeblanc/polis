import {
  createMidpointKernels,
  midpointKernelForFlow,
  type NormalizedDuration,
} from '../models/birds/midpointKernels';
import { constructBirdsMotionSupport } from '../models/birds/motionSupport';
import { createBirdsCoarseInitialization } from '../models/birds/coarseInitialization';
import { BIRDS_COARSE_CELL_LENGTH, birdsScale } from '../models/birds/scales';

export interface BirdsPopulationBoundParameters {
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly populationDensity: number;
}

export interface BirdsPopulationBound {
  readonly coarsePopulation: bigint;
  readonly diffusionRate: number;
  readonly epoch: number;
  readonly epochConcentrationFactor: bigint;
  readonly firstMidpointFanIn: number;
  readonly halfDurationOffsetCount: number;
  readonly maximumCellPopulation: bigint;
  readonly quarterMidpointFanIn: number;
  readonly scaleCellWidth: number;
  readonly wholeDurationOffsetCount: number;
}

export interface BirdsReachabilityPopulationBound {
  readonly epoch: number;
  readonly maximumCellPopulation: bigint;
  readonly maximizingSpatialPhase: number;
  readonly maximizingTimePhase: number;
  readonly spatialPhaseCount: number;
  readonly timePhaseCount: number;
}

interface IndexedFlow {
  readonly destination: number;
  readonly source: number;
}

const reachabilityCache = new Map<string, BirdsReachabilityPopulationBound>();

/**
 * A seed-independent structural upper bound. Every temporal midpoint cell can receive at
 * most one complete source-cell population from each source offset in its inverse support.
 */
export function deriveBirdsPopulationBound(
  parameters: BirdsPopulationBoundParameters,
): BirdsPopulationBound {
  validateParameters(parameters);
  const scale = birdsScale(parameters.epoch)!;
  const support = constructBirdsMotionSupport(parameters.diffusionRate);
  const kernels = createMidpointKernels(parameters.diffusionRate);
  const firstMidpointFanIn = midpointSourceFanIn(
    support.epochOffsets,
    kernels,
    1,
  );
  const quarterMidpointFanIn = midpointSourceFanIn(
    support.halfDurationOffsets,
    kernels,
    0.5,
  );
  const epochConcentrationFactor =
    BigInt(firstMidpointFanIn) * BigInt(quarterMidpointFanIn);
  const coarsePopulation = BigInt(
    Math.round(parameters.populationDensity * BIRDS_COARSE_CELL_LENGTH),
  );
  return {
    diffusionRate: parameters.diffusionRate,
    epoch: parameters.epoch,
    scaleCellWidth: scale.cellLength,
    coarsePopulation,
    wholeDurationOffsetCount: support.epochOffsets.length,
    halfDurationOffsetCount: support.halfDurationOffsets.length,
    firstMidpointFanIn,
    quarterMidpointFanIn,
    epochConcentrationFactor,
    maximumCellPopulation: coarsePopulation * epochConcentrationFactor ** BigInt(parameters.epoch),
  };
}

/**
 * Tighter support-capacity bound obtained by refining every nonzero coarse flow and
 * charging each distinct ancestral coarse flow at most its deterministic capacity.
 * Its exhaustive support enumeration is intended only for shallow diagnostic cases.
 */
export function deriveBirdsReachabilityPopulationBound(
  parameters: BirdsPopulationBoundParameters,
): BirdsReachabilityPopulationBound {
  validateParameters(parameters);
  if (parameters.epoch > 3) {
    throw new RangeError('Reachability bound is limited to epoch 3 diagnostic grids');
  }
  const cacheKey = `${parameters.diffusionRate}:${parameters.populationDensity}:${parameters.epoch}`;
  const cached = reachabilityCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const initialization = createBirdsCoarseInitialization(
    parameters.populationDensity,
    parameters.diffusionRate,
  );
  const kernels = createMidpointKernels(parameters.diffusionRate);
  const activeOffsets = initialization.flows.filter(({ count }) => count > 0);
  const reachableByOffset = new Map<number, readonly ReadonlySet<number>[]>();

  for (const { offset } of activeOffsets) {
    let segments: readonly ReadonlyMap<string, IndexedFlow>[] = [
      new Map([[flowKey(0, offset), { source: 0, destination: offset }]]),
    ];
    for (let epoch = 0; epoch < parameters.epoch; epoch += 1) {
      segments = refineReachableSegments(segments, kernels);
    }
    reachableByOffset.set(offset, cellsAtTimes(segments));
  }

  const spatialPhaseCount = 2 ** parameters.epoch;
  const timePhaseCount = 4 ** parameters.epoch;
  let maximumCellPopulation = 0n;
  let maximizingSpatialPhase = 0;
  let maximizingTimePhase = 0;
  for (let timePhase = 0; timePhase < timePhaseCount; timePhase += 1) {
    for (let spatialPhase = 0; spatialPhase < spatialPhaseCount; spatialPhase += 1) {
      let capacity = 0n;
      for (const { offset, count } of activeOffsets) {
        const sourceCells = new Set<number>();
        for (const reachableCell of reachableByOffset.get(offset)![timePhase]) {
          const difference = spatialPhase - reachableCell;
          if (difference % spatialPhaseCount === 0) {
            sourceCells.add(difference / spatialPhaseCount);
          }
        }
        capacity += BigInt(sourceCells.size) * BigInt(count);
      }
      if (capacity > maximumCellPopulation) {
        maximumCellPopulation = capacity;
        maximizingSpatialPhase = spatialPhase;
        maximizingTimePhase = timePhase;
      }
    }
  }
  const result = {
    epoch: parameters.epoch,
    maximumCellPopulation,
    maximizingSpatialPhase,
    maximizingTimePhase,
    spatialPhaseCount,
    timePhaseCount,
  };
  reachabilityCache.set(cacheKey, result);
  return result;
}

function refineReachableSegments(
  segments: readonly ReadonlyMap<string, IndexedFlow>[],
  kernels: ReturnType<typeof createMidpointKernels>,
): readonly ReadonlyMap<string, IndexedFlow>[] {
  const refined = Array.from(
    { length: segments.length * 4 },
    () => new Map<string, IndexedFlow>(),
  );
  for (let segment = 0; segment < segments.length; segment += 1) {
    for (const flow of segments[segment].values()) {
      const firstMidpoints = midpointKernelForFlow(
        kernels,
        flow.destination - flow.source,
        1,
      );
      for (const { value: firstValue } of firstMidpoints) {
        const midpoint = flow.source + firstValue;
        addRefinedHalfFlow(refined, 4 * segment, flow.source, midpoint, kernels);
        addRefinedHalfFlow(refined, 4 * segment + 2, midpoint, flow.destination, kernels);
      }
    }
  }
  return refined;
}

function addRefinedHalfFlow(
  refined: readonly Map<string, IndexedFlow>[],
  firstSegment: number,
  source: number,
  destination: number,
  kernels: ReturnType<typeof createMidpointKernels>,
): void {
  for (const { value } of midpointKernelForFlow(kernels, destination - source, 0.5)) {
    const midpoint = source + value;
    addSpatialChildren(refined[firstSegment], source, midpoint);
    addSpatialChildren(refined[firstSegment + 1], midpoint, destination);
  }
}

function addSpatialChildren(
  flows: Map<string, IndexedFlow>,
  source: number,
  destination: number,
): void {
  for (let sourceChild = 0; sourceChild < 2; sourceChild += 1) {
    for (let destinationChild = 0; destinationChild < 2; destinationChild += 1) {
      const childSource = 2 * source + sourceChild;
      const childDestination = 2 * destination + destinationChild;
      flows.set(flowKey(childSource, childDestination), {
        source: childSource,
        destination: childDestination,
      });
    }
  }
}

function cellsAtTimes(
  segments: readonly ReadonlyMap<string, IndexedFlow>[],
): readonly ReadonlySet<number>[] {
  const cells = Array.from({ length: segments.length + 1 }, () => new Set<number>());
  for (let segment = 0; segment < segments.length; segment += 1) {
    for (const flow of segments[segment].values()) {
      cells[segment].add(flow.source);
      cells[segment + 1].add(flow.destination);
    }
  }
  return cells;
}

function flowKey(source: number, destination: number): string {
  return `${source},${destination}`;
}

function midpointSourceFanIn(
  parentOffsets: readonly number[],
  kernels: ReturnType<typeof createMidpointKernels>,
  normalizedDuration: NormalizedDuration,
): number {
  const sourceOffsets = new Set<number>();
  for (const parentOffset of parentOffsets) {
    for (const { value } of midpointKernelForFlow(kernels, parentOffset, normalizedDuration)) {
      // For a target midpoint at index zero, sourceIndex + value = 0.
      sourceOffsets.add(-value);
    }
  }
  return sourceOffsets.size;
}

function validateParameters(parameters: BirdsPopulationBoundParameters): void {
  if (birdsScale(parameters.epoch) === undefined) {
    throw new RangeError('Population-bound epoch is unavailable');
  }
  if (!Number.isFinite(parameters.diffusionRate) || parameters.diffusionRate < 0) {
    throw new RangeError('Population-bound diffusion rate must be finite and nonnegative');
  }
  if (!Number.isFinite(parameters.populationDensity) || parameters.populationDensity < 0) {
    throw new RangeError('Population-bound density must be finite and nonnegative');
  }
  const coarsePopulation = Math.round(parameters.populationDensity * BIRDS_COARSE_CELL_LENGTH);
  if (!Number.isSafeInteger(coarsePopulation)) {
    throw new RangeError('Population-bound coarse population must be a safe integer');
  }
}
