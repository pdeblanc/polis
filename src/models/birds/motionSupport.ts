import { LRUCache } from 'lru-cache';
import { roundedNormal } from '../../utils/distributions/roundedNormal';
import { classifyCell, classifyFlow } from './classifiers';
import { cellLength, type BirdCell, type BirdFlow } from './entities';
import {
  createMidpointKernels,
  midpointKernelForFlow,
  type MidpointKernels,
  type NormalizedDuration,
} from './midpointKernels';
import { classifyFlowTimeSubdivisionOwner } from './ownerClassifiers';
import { birdsScale, epochForCellLength } from './scales';

export const BIRDS_MOTION_SUPPORT_CACHE_CAPACITY = 32;

export interface BirdsMotionSupport {
  readonly diffusionRate: number;
  readonly coarseOffsets: readonly number[];
  readonly epochOffsets: readonly number[];
  readonly halfDurationOffsets: readonly number[];
  readonly quarterDurationOffsets: readonly number[];
  readonly iterations: number;
}

interface InternalMotionSupport extends BirdsMotionSupport {
  readonly coarseOffsetSet: ReadonlySet<number>;
  readonly epochOffsetSet: ReadonlySet<number>;
  readonly halfDurationOffsetSet: ReadonlySet<number>;
  readonly quarterDurationOffsetSet: ReadonlySet<number>;
  readonly midpointKernels: MidpointKernels;
}

const supportCache = new LRUCache<number, InternalMotionSupport>({
  max: BIRDS_MOTION_SUPPORT_CACHE_CAPACITY,
});

/** Constructs the minimal epoch-flow support closed under a complete refinement epoch. */
export function constructBirdsMotionSupport(diffusionRate: number): BirdsMotionSupport {
  return getMotionSupport(diffusionRate);
}

export function clearBirdsMotionSupportCache(): void {
  supportCache.clear();
}

/** Enumerates nonzero midpoint categories owned by one supported entry or half flow. */
export function possibleMidpointCells(
  flow: BirdFlow,
  diffusionRate: number,
): readonly BirdCell[] {
  const owner = classifyFlowTimeSubdivisionOwner(flow);
  if (owner === undefined || !isPossibleFlow(flow, diffusionRate)) return [];

  const support = getMotionSupport(diffusionRate);
  const sourceIndex = spatialIndex(flow.source);
  const destinationIndex = spatialIndex(flow.destination);
  const flowOffset = destinationIndex - sourceIndex;
  return midpointKernelForFlow(
    support.midpointKernels,
    flowOffset,
    owner.normalizedDuration,
  ).map(({ value }) =>
    indexedCell(
      sourceIndex + value,
      owner.midpointCellLength,
      owner.midpointTime,
    ),
  );
}

/** Algebraically inverts midpoint support for one legal Stage-B or Stage-D leg. */
export function possibleParentFlows(
  flow: BirdFlow,
  diffusionRate: number,
): readonly BirdFlow[] {
  const construction = classifyFlow(flow);
  if (
    construction?.kind !== 'temporal-aggregation' ||
    !isPossibleFlow(flow, diffusionRate)
  ) {
    return [];
  }

  const parents: BirdFlow[] = [];
  if (construction.leg === 'first') {
    const source = flow.source;
    for (const destination of possibleFlowDestinations(
      source,
      construction.parentDuration,
      diffusionRate,
    )) {
      if (cellLength(destination) !== cellLength(source)) continue;
      const parent = { source, destination };
      if (containsCell(possibleMidpointCells(parent, diffusionRate), flow.destination)) {
        parents.push(parent);
      }
    }
  } else {
    const destination = flow.destination;
    for (const source of possibleFlowSources(
      destination,
      construction.parentDuration,
      diffusionRate,
    )) {
      if (cellLength(source) !== cellLength(destination)) continue;
      const parent = { source, destination };
      if (containsCell(possibleMidpointCells(parent, diffusionRate), flow.source)) {
        parents.push(parent);
      }
    }
  }

  return parents.sort(compareFlows);
}

/** Enumerates every supported destination resolution for a source and duration. */
export function possibleFlowDestinations(
  source: BirdCell,
  duration: number,
  diffusionRate: number,
): readonly BirdCell[] {
  const epoch = epochForCellLength(cellLength(source));
  const scale = epoch === undefined ? undefined : birdsScale(epoch);
  if (epoch === undefined || scale === undefined || classifyCell(source) === undefined) return [];

  const candidates: BirdCell[] = [];
  const sourceIndex = spatialIndex(source);
  const destinationTime = source.time + duration;
  const support = getMotionSupport(diffusionRate);

  for (const offset of equalResolutionOffsets(epoch, source.time, duration, scale, support)) {
    candidates.push(indexedCell(sourceIndex + offset, scale.cellLength, destinationTime));
  }

  if (duration === scale.nextFlowDuration) {
    for (const offset of support.quarterDurationOffsets) {
      const parentDestinationIndex = sourceIndex + offset;
      candidates.push(indexedCell(2 * parentDestinationIndex, scale.childCellLength, destinationTime));
      candidates.push(
        indexedCell(2 * parentDestinationIndex + 1, scale.childCellLength, destinationTime),
      );
    }
  }

  if (epoch > 0 && duration === scale.flowDuration) {
    const parentScale = birdsScale(epoch - 1)!;
    const parentSourceIndex = Math.floor(sourceIndex / 2);
    for (const offset of support.quarterDurationOffsets) {
      candidates.push(
        indexedCell(
          parentSourceIndex + offset,
          parentScale.cellLength,
          destinationTime,
        ),
      );
    }
  }

  return uniqueCells(
    candidates.filter((destination) =>
      isPossibleFlow({ source, destination }, diffusionRate),
    ),
  );
}

/** Enumerates every supported source resolution for a destination and duration. */
export function possibleFlowSources(
  destination: BirdCell,
  duration: number,
  diffusionRate: number,
): readonly BirdCell[] {
  const epoch = epochForCellLength(cellLength(destination));
  const scale = epoch === undefined ? undefined : birdsScale(epoch);
  if (
    epoch === undefined ||
    scale === undefined ||
    classifyCell(destination) === undefined
  ) {
    return [];
  }

  const candidates: BirdCell[] = [];
  const destinationIndex = spatialIndex(destination);
  const sourceTime = destination.time - duration;
  const support = getMotionSupport(diffusionRate);

  for (const offset of equalResolutionOffsets(epoch, sourceTime, duration, scale, support)) {
    candidates.push(indexedCell(destinationIndex - offset, scale.cellLength, sourceTime));
  }

  if (duration === scale.nextFlowDuration) {
    for (const offset of support.quarterDurationOffsets) {
      const parentSourceIndex = destinationIndex - offset;
      candidates.push(indexedCell(2 * parentSourceIndex, scale.childCellLength, sourceTime));
      candidates.push(indexedCell(2 * parentSourceIndex + 1, scale.childCellLength, sourceTime));
    }
  }

  if (epoch > 0 && duration === scale.flowDuration) {
    const parentScale = birdsScale(epoch - 1)!;
    const parentDestinationIndex = Math.floor(destinationIndex / 2);
    for (const offset of support.quarterDurationOffsets) {
      candidates.push(
        indexedCell(
          parentDestinationIndex - offset,
          parentScale.cellLength,
          sourceTime,
        ),
      );
    }
  }

  return uniqueCells(
    candidates.filter((source) =>
      isPossibleFlow({ source, destination }, diffusionRate),
    ),
  );
}

/** Returns false for both invalid flow geometry and legal flows outside finite support. */
export function isPossibleFlow(flow: BirdFlow, diffusionRate: number): boolean {
  const construction = classifyFlow(flow);
  if (construction === undefined) return false;
  const support = getMotionSupport(diffusionRate);

  switch (construction.kind) {
    case 'coarse-initialized':
      return support.coarseOffsetSet.has(construction.coarseKernelOffset);

    case 'temporal-aggregation': {
      const offset = spatialIndex(flow.destination) - spatialIndex(flow.source);
      return (construction.stage === 'B'
        ? support.halfDurationOffsetSet
        : support.quarterDurationOffsetSet
      ).has(offset);
    }

    case 'source-spatial-child': {
      const parentSourceIndex = spatialIndex(construction.sourceParentCell);
      const destinationIndex = spatialIndex(flow.destination);
      return support.quarterDurationOffsetSet.has(destinationIndex - parentSourceIndex);
    }

    case 'destination-spatial-child': {
      const sourceIndex = spatialIndex(flow.source);
      const parentDestinationIndex = spatialIndex(construction.destinationParentCell);
      return support.quarterDurationOffsetSet.has(parentDestinationIndex - sourceIndex);
    }

    case 'fully-spatially-refined': {
      const offset = spatialIndex(flow.destination) - spatialIndex(flow.source);
      return support.epochOffsetSet.has(offset);
    }
  }
}

export function possibleQuarterFlowOffsets(
  parentOffset: number,
  diffusionRate: number,
): ReadonlySet<number> {
  assertIntegerOffset(parentOffset);
  return new Set(
    quarterOffsetsForParent(parentOffset, getMotionSupport(diffusionRate).midpointKernels),
  );
}

export function midpointOffsets(
  flowOffset: number,
  diffusionRate: number,
  normalizedDuration: NormalizedDuration,
): ReadonlySet<number> {
  assertIntegerOffset(flowOffset);
  return new Set(
    midpointOffsetsWithKernels(
      flowOffset,
      normalizedDuration,
      getMotionSupport(diffusionRate).midpointKernels,
    ),
  );
}

function getMotionSupport(diffusionRate: number): InternalMotionSupport {
  assertDiffusionRate(diffusionRate);
  const cached = supportCache.get(diffusionRate);
  if (cached !== undefined) return cached;

  const midpointKernels = createMidpointKernels(diffusionRate);
  const coarseOffsetSet = symmetrize(
    roundedNormal(0, Math.sqrt(1 / 12 + diffusionRate)).map(({ value }) => value),
  );
  let epochOffsetSet = new Set(coarseOffsetSet);
  let iterations = 0;

  while (true) {
    const next = new Set(epochOffsetSet);
    for (const parentOffset of epochOffsetSet) {
      for (const quarterOffset of quarterOffsetsForParent(parentOffset, midpointKernels)) {
        next.add(2 * quarterOffset - 1);
        next.add(2 * quarterOffset);
        next.add(2 * quarterOffset + 1);
      }
    }

    iterations += 1;
    if (setsEqual(next, epochOffsetSet)) break;
    epochOffsetSet = next;
  }

  const halfDurationOffsetSet = new Set<number>();
  const quarterDurationOffsetSet = new Set<number>();
  for (const parentOffset of epochOffsetSet) {
    for (const midpointOffset of midpointOffsetsWithKernels(
      parentOffset,
      1,
      midpointKernels,
    )) {
      halfDurationOffsetSet.add(midpointOffset);
      halfDurationOffsetSet.add(parentOffset - midpointOffset);
    }
    for (const quarterOffset of quarterOffsetsForParent(parentOffset, midpointKernels)) {
      quarterDurationOffsetSet.add(quarterOffset);
    }
  }

  const support: InternalMotionSupport = {
    diffusionRate,
    coarseOffsets: sorted(coarseOffsetSet),
    epochOffsets: sorted(epochOffsetSet),
    halfDurationOffsets: sorted(halfDurationOffsetSet),
    quarterDurationOffsets: sorted(quarterDurationOffsetSet),
    iterations,
    coarseOffsetSet,
    epochOffsetSet,
    halfDurationOffsetSet,
    quarterDurationOffsetSet,
    midpointKernels,
  };
  supportCache.set(diffusionRate, support);
  return support;
}

function equalResolutionOffsets(
  epoch: number,
  startTime: number,
  duration: number,
  scale: NonNullable<ReturnType<typeof birdsScale>>,
  support: InternalMotionSupport,
): readonly number[] {
  if (duration === scale.flowDuration) {
    return epoch === 0 && startTime % scale.flowDuration === 0
      ? support.coarseOffsets
      : support.epochOffsets;
  }
  if (duration === scale.halfFlowDuration) return support.halfDurationOffsets;
  if (duration === scale.nextFlowDuration) return support.quarterDurationOffsets;
  return [];
}

function quarterOffsetsForParent(
  parentOffset: number,
  midpointKernels: MidpointKernels,
): readonly number[] {
  const result = new Set<number>();
  for (const midpointOffset of midpointOffsetsWithKernels(parentOffset, 1, midpointKernels)) {
    for (const firstQuarterOffset of midpointOffsetsWithKernels(
      midpointOffset,
      0.5,
      midpointKernels,
    )) {
      result.add(firstQuarterOffset);
      result.add(midpointOffset - firstQuarterOffset);
    }

    const secondHalfOffset = parentOffset - midpointOffset;
    for (const secondQuarterOffset of midpointOffsetsWithKernels(
      secondHalfOffset,
      0.5,
      midpointKernels,
    )) {
      result.add(secondQuarterOffset);
      result.add(secondHalfOffset - secondQuarterOffset);
    }
  }
  return sorted(result);
}

function midpointOffsetsWithKernels(
  flowOffset: number,
  normalizedDuration: NormalizedDuration,
  midpointKernels: MidpointKernels,
): readonly number[] {
  return midpointKernelForFlow(midpointKernels, flowOffset, normalizedDuration).map(
    ({ value }) => value,
  );
}

function indexedCell(index: number, length: number, time: number): BirdCell {
  return { min: index * length, max: (index + 1) * length, time };
}

function spatialIndex(cell: BirdCell): number {
  return cell.min / cellLength(cell);
}

function uniqueCells(cells: readonly BirdCell[]): readonly BirdCell[] {
  const byKey = new Map<string, BirdCell>();
  for (const cell of cells) byKey.set(`${cell.min}:${cell.max}:${cell.time}`, cell);
  return [...byKey.values()].sort(compareCells);
}

function compareCells(left: BirdCell, right: BirdCell): number {
  return left.min - right.min || left.max - right.max || left.time - right.time;
}

function compareFlows(left: BirdFlow, right: BirdFlow): number {
  return compareCells(left.source, right.source) || compareCells(left.destination, right.destination);
}

function containsCell(cells: readonly BirdCell[], target: BirdCell): boolean {
  return cells.some(
    (cell) => cell.min === target.min && cell.max === target.max && cell.time === target.time,
  );
}

function sorted(values: ReadonlySet<number>): readonly number[] {
  return [...values].sort((left, right) => left - right);
}

function symmetrize(values: readonly number[]): Set<number> {
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

function assertDiffusionRate(diffusionRate: number): void {
  if (!Number.isFinite(diffusionRate) || diffusionRate < 0) {
    throw new RangeError('Diffusion rate must be a finite nonnegative number');
  }
}

function assertIntegerOffset(offset: number): void {
  if (!Number.isSafeInteger(offset)) {
    throw new RangeError('Flow offset must be a safe integer');
  }
}
