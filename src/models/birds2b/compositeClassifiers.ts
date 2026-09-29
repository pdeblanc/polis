import { EXPANSION_DEFAULT_CELL_WIDTH, EXPANSION_TIME_PER_WIDTH_SQUARED } from '../birds2a/expansion';
import { classifyBirds2aCellGeometry as classifyCompositeCellGeometry, classifyBirds2FlowGeometry } from '../birds2a/classifiers';
export { classifyBirds2aCellGeometry as classifyCompositeCellGeometry } from '../birds2a/classifiers';
export type { BirdCell as CompositeCell, BirdFlow as CompositeFlow } from '../birds/entities';
import type { BirdCell as CompositeCell, BirdFlow as CompositeFlow } from '../birds/entities';

export type CompositeCellConstruction =
  | { readonly kind: 'channel-merge' }
  | { readonly kind: 'spatial-child'; readonly stage: 'F'; readonly subdivisionOwner: CompositeCell; readonly childIndex: 0 | 1 }
  | { readonly kind: 'temporal-aggregation'; readonly stage: 'E'; readonly outgoingDuration: number };

export type CompositeCellSubdivision = {
  readonly owner: CompositeCell;
  readonly children: readonly [CompositeCell, CompositeCell];
} & (
  | { readonly kind: 'channel-merge' }
  | { readonly kind: 'binomial'; readonly probability: 0.5 }
);

export type CompositeFlowConstruction =
  | { readonly kind: 'channel-merge' }
  | { readonly kind: 'spatial-reconciliation'; readonly stage: 'H'; readonly subdivisionOwner: CompositeFlow;
      readonly sourceChildIndex: 0 | 1; readonly destinationChildIndex: 0 | 1 }
  | { readonly kind: 'source-subdivision'; readonly stage: 'G1'; readonly subdivisionOwner: CompositeCell;
      readonly childIndex: 0 | 1 }
  | { readonly kind: 'destination-subdivision'; readonly stage: 'G2'; readonly subdivisionOwner: CompositeCell;
      readonly childIndex: 0 | 1 }
  | { readonly kind: 'temporal-aggregation'; readonly stage: 'B' | 'D'; readonly leg: 'first' | 'second';
      readonly parentDuration: number; readonly enclosingStartTime: number; readonly enclosingEndTime: number };

/** Pure geometry only. Classification never examines population, seed, or cache state.
 * Merge ownership is fixed by the global temporal bands, never by a query/cache. */
export function classifyCompositeCell(cell: CompositeCell): CompositeCellConstruction | undefined {
  const scale = classifyCompositeCellGeometry(cell);
  if (!scale) return undefined;
  const mergeWidth = mergeFrameWidth(cell.time);
  if (mergeWidth !== undefined && scale.cellWidth >= mergeWidth) return { kind: 'channel-merge' };
  if (Number.isInteger(cell.time / scale.duration)) {
    return { kind: 'spatial-child', stage: 'F', subdivisionOwner: parent(cell), childIndex: childIndex(cell) };
  }
  return { kind: 'temporal-aggregation', stage: 'E', outgoingDuration: scale.quarterDuration };
}

/** Classify the whole F batch, not just its entries: retained child counts must
 * never be replaced by an independent binomial split of their parent. */
export function classifyCompositeCellSubdivision(cell: CompositeCell): CompositeCellSubdivision | undefined {
  const scale = classifyCompositeCellGeometry(cell);
  if (!scale) return undefined;
  const middle = cell.min + scale.cellWidth / 2;
  const children = [
    { min: cell.min, max: middle, time: cell.time },
    { min: middle, max: cell.max, time: cell.time },
  ] as const;
  const mergeWidth = mergeFrameWidth(cell.time);
  return mergeWidth !== undefined && scale.cellWidth / 2 >= mergeWidth
    ? { kind: 'channel-merge', owner: cell, children }
    : { kind: 'binomial', owner: cell, children, probability: 0.5 };
}

export function classifyCompositeFlow(flow: CompositeFlow): CompositeFlowConstruction | undefined {
  const geometry = classifyBirds2FlowGeometry(flow);
  if (!geometry) return undefined;
  const { source, destination, duration, equalWidth } = geometry;
  if (isChannelMergeFlow(flow)) return { kind: 'channel-merge' };
  if (!equalWidth) {
    return source.cellWidth < destination.cellWidth
      ? { kind: 'source-subdivision', stage: 'G1', subdivisionOwner: parent(flow.source), childIndex: childIndex(flow.source) }
      : { kind: 'destination-subdivision', stage: 'G2', subdivisionOwner: parent(flow.destination), childIndex: childIndex(flow.destination) };
  }
  if (duration === source.duration) {
    return { kind: 'spatial-reconciliation', stage: 'H',
      subdivisionOwner: { source: parent(flow.source), destination: parent(flow.destination) },
      sourceChildIndex: childIndex(flow.source), destinationChildIndex: childIndex(flow.destination) };
  }
  const first = (flow.source.time / duration) % 2 === 0;
  const start = first ? flow.source.time : flow.source.time - duration;
  return { kind: 'temporal-aggregation', stage: duration === source.halfDuration ? 'B' : 'D',
    leg: first ? 'first' : 'second', parentDuration: 2 * duration,
    enclosingStartTime: start, enclosingEndTime: start + 2 * duration };
}

/** Finest imported spatial width at a band endpoint. Shared endpoints have one owner. */
function mergeFrameWidth(time: number): number | undefined {
  if (time === 0) return EXPANSION_DEFAULT_CELL_WIDTH;
  const band = shellAt(Math.abs(time));
  if (!band || !Number.isInteger(band.slot)) return undefined;
  if (band.slot === 1) return band.epoch === 0 ? band.cellWidth : band.cellWidth / 2;
  return band.cellWidth;
}

/** Checked ownership predicate; does not allocate refinement owners. */
export function isCompositeMergeFlow(flow: CompositeFlow): boolean {
  return !!classifyBirds2FlowGeometry(flow) && isChannelMergeFlow(flow);
}

function isChannelMergeFlow(flow: CompositeFlow): boolean {
  const backwards = flow.destination.time <= 0;
  const inner = backwards ? flow.destination : flow.source;
  const outer = backwards ? flow.source : flow.destination;
  if (inner.time === 0) {
    const width = mergeFrameWidth(outer.time);
    return width !== undefined && inner.max - inner.min >= EXPANSION_DEFAULT_CELL_WIDTH &&
      outer.max - outer.min >= width;
  }
  const band = shellAt(Math.abs(inner.time));
  if (!band || !Number.isInteger(band.slot) || inner.max - inner.min < band.cellWidth ||
    outer.max - outer.min < band.cellWidth) return false;
  const slot = Math.abs(outer.time) / band.duration;
  return Number.isInteger(slot) && slot > band.slot && slot <= 4 &&
    ((band.slot === 2 && slot === 4) || slot === band.slot + 1);
}

function shellAt(time: number) {
  const base = Math.log2(EXPANSION_DEFAULT_CELL_WIDTH);
  const epoch = Math.floor((Math.log2(time / EXPANSION_TIME_PER_WIDTH_SQUARED) - 2 * base) / 2);
  if (!Number.isFinite(epoch) || epoch < 0) return undefined;
  const cellWidth = 2 ** (base + epoch), duration = EXPANSION_TIME_PER_WIDTH_SQUARED * cellWidth ** 2;
  const slot = time / duration;
  return slot >= 1 && slot < 4 ? { epoch, cellWidth, duration, slot } : undefined;
}

function parent(cell: CompositeCell): CompositeCell {
  const width = 2 * (cell.max - cell.min), min = Math.floor(cell.min / width) * width;
  return { min: min === 0 ? 0 : min, max: min + width, time: cell.time };
}
function childIndex(cell: CompositeCell): 0 | 1 {
  const index = cell.min / (cell.max - cell.min);
  return ((index % 2 + 2) % 2) as 0 | 1;
}
