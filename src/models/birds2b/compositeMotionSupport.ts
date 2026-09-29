import { classifyBirds2FlowGeometry } from '../birds2a/classifiers';
import { isWithinBirds2MotionSupport } from '../birds2a/motionSupport';
import { EXPANSION_TIME_PER_WIDTH_SQUARED } from '../birds2a/expansion';
import type { Birds2aMotionSupport as CompositeMotionSupport } from '../birds2a/motionSupport';
import { midpointKernelForFlow, midpointKernelContainsCell } from '../birds/midpointKernels';
import { classifyCompositeCellGeometry, classifyCompositeFlow, type CompositeCell, type CompositeFlow } from './compositeClassifiers';
import { classifyCompositeFlowTimeSubdivision } from './compositeOwnerClassifiers';

export function isPossibleCompositeFlow(flow: CompositeFlow, support: CompositeMotionSupport): boolean {
  return !!classifyBirds2FlowGeometry(flow) && isWithinBirds2MotionSupport(flow, support);
}

/** Enumerate all legal opposite widths, or just oppositeWidth when supplied.
 * Both paths return spatial order; the single-width path needs no sorting. */
export function possibleCompositeFlowDestinations(
  source: CompositeCell, duration: number, support: CompositeMotionSupport, oppositeWidth?: number,
): readonly CompositeCell[] {
  return incidentCells(source, duration, support, true, oppositeWidth);
}

export function possibleCompositeFlowSources(
  destination: CompositeCell, duration: number, support: CompositeMotionSupport, oppositeWidth?: number,
): readonly CompositeCell[] {
  return incidentCells(destination, duration, support, false, oppositeWidth);
}

function incidentCells(fixed: CompositeCell, duration: number,
  support: CompositeMotionSupport, forwards: boolean, oppositeWidth?: number): readonly CompositeCell[] {
  const scale = classifyCompositeCellGeometry(fixed);
  if (!scale || !(duration > 0) || !Number.isFinite(duration)) return [];
  const time = fixed.time + (forwards ? duration : -duration);
  const result: CompositeCell[] = [];
  for (const width of oppositeWidth === undefined
    ? [scale.cellWidth / 2, scale.cellWidth, scale.cellWidth * 2] : [oppositeWidth]) {
    const probe = indexedCell(0, width, time);
    const makeFlow = (opposite: CompositeCell): CompositeFlow => forwards
      ? { source: fixed, destination: opposite } : { source: opposite, destination: fixed };
    if (!classifyBirds2FlowGeometry(makeFlow(probe))) continue;
    const coarseWidth = Math.max(width, scale.cellWidth);
    const full = EXPANSION_TIME_PER_WIDTH_SQUARED * coarseWidth ** 2;
    const radius = Math.floor(duration === full ? support.entryRadius
      : duration === full / 2 ? support.halfRadius : support.quarterRadius);
    const center = Math.floor(fixed.min / coarseWidth), ratio = coarseWidth / width;
    const first = (center - radius) * ratio, last = (center + radius + 1) * ratio - 1;
    // Without this guard an index increment can stop making progress at numeric limits.
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) throw new RangeError('Motion window exceeds numeric index precision');
    for (let index = first; index <= last; index++) result.push(indexedCell(index, width, time));
  }
  return oppositeWidth === undefined ? result.sort((a, b) => a.min - b.min || a.max - b.max) : result;
}

/** Only refinement-owned A/C batches are valid here. Merge-owned legs throw
 * in the owner classifier rather than inventing an unavailable joint allocation. */
export function compositeMidpointCellProbabilities(
  flow: CompositeFlow, support: CompositeMotionSupport,
): readonly { readonly cell: CompositeCell; readonly probability: number }[] {
  const owner = classifyCompositeFlowTimeSubdivision(flow);
  if (!owner || !isWithinBirds2MotionSupport(flow, support)) return [];
  const width = owner.midpointCellWidth, sourceIndex = flow.source.min / width;
  const offset = flow.destination.min / width - sourceIndex;
  return midpointKernelForFlow(support.midpointKernels, offset, owner.normalizedDuration)
    .filter(({ probability }) => probability > 0)
    .map(({ value, probability }) => ({ cell: indexedCell(sourceIndex + value, width, owner.midpointTime), probability }));
}

/** Invert the midpoint support for a B/D leg. Ordinary merge facts have no
 * parent search: their classifier routes them directly to retained output. */
export function possibleCompositeParentFlows(
  flow: CompositeFlow, support: CompositeMotionSupport,
): readonly CompositeFlow[] {
  const construction = classifyCompositeFlow(flow);
  if (construction?.kind !== 'temporal-aggregation' || !isWithinBirds2MotionSupport(flow, support)) return [];
  const first = construction.leg === 'first';
  const width = flow.source.max - flow.source.min;
  const midpoint = first ? flow.destination : flow.source;
  const candidates = first
    ? possibleCompositeFlowDestinations(flow.source, construction.parentDuration, support, width)
    : possibleCompositeFlowSources(flow.destination, construction.parentDuration, support, width);
  if (candidates.length === 0) return [];
  const makeParent = (cell: CompositeCell): CompositeFlow => first
    ? { source: flow.source, destination: cell } : { source: cell, destination: flow.destination };
  // All candidates have identical times and widths. Their temporal ownership
  // and legality are therefore shared; the enumerator supplies aligned cells.
  // Still use a real candidate so numeric-boundary validation is preserved.
  const owner = classifyCompositeFlowTimeSubdivision(makeParent(candidates[0]));
  if (!owner) return [];
  const radius = owner.normalizedDuration === 1 ? support.entryRadius : support.halfRadius;
  const fixedIndex = (first ? flow.source.min : flow.destination.min) / width;
  const result: CompositeFlow[] = [];
  for (const cell of candidates) {
    const sourceIndex = first ? fixedIndex : cell.min / width;
    const destinationIndex = first ? cell.min / width : fixedIndex;
    if (Math.abs(Math.floor(destinationIndex) - Math.floor(sourceIndex)) > radius) continue;
    if (midpointKernelContainsCell(support.midpointKernels, destinationIndex - sourceIndex,
      owner.normalizedDuration, sourceIndex, width, midpoint.min)) result.push(makeParent(cell));
  }
  return result;
}

function indexedCell(index: number, width: number, time: number): CompositeCell {
  return { min: index === 0 ? 0 : index * width, max: (index + 1) * width, time };
}
