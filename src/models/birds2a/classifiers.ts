import { EXPANSION_TIME_PER_WIDTH_SQUARED, type ExpansionCell } from './expansion';

export interface Birds2aCell extends ExpansionCell { readonly time: number }
export interface Birds2aFlow { readonly source: Birds2aCell; readonly destination: Birds2aCell }
export type ExpansionBranch = 'forward' | 'backward';

/** A location in the finest retained frame at a recorded time. */
export type ExpansionFrameProjection =
  | { readonly kind: 'initial-origin'; readonly epoch: 0; readonly cellWidth: number }
  | { readonly kind: 'initial-endpoint'; readonly epoch: 0; readonly cellWidth: number; readonly branch: ExpansionBranch }
  | { readonly kind: 'extension-frame'; readonly epoch: number; readonly cellWidth: number;
      readonly branch: ExpansionBranch; readonly slot: 2 | 3 | 4 };

export type ExpansionFlowProjection =
  | { readonly kind: 'origin-endpoint'; readonly originCell: Birds2aCell;
      readonly endpointCell: Birds2aCell; readonly frame: ExpansionFrameProjection }
  | { readonly kind: 'extension-step'; readonly epoch: number; readonly branch: ExpansionBranch;
      readonly innerCell: Birds2aCell; readonly outerCell: Birds2aCell;
      readonly stepIndex: 0 | 1 | 2 }
  | { readonly kind: 'extension-half'; readonly epoch: number; readonly branch: ExpansionBranch;
      readonly innerCell: Birds2aCell; readonly outerCell: Birds2aCell };

export type Birds2aCellConstruction =
  | { readonly kind: 'expansion'; readonly projection: ExpansionFrameProjection }
  | { readonly kind: 'spatial-child'; readonly stage: 'F'; readonly subdivisionOwner: Birds2aCell; readonly childIndex: 0 | 1 }
  | { readonly kind: 'temporal-aggregation'; readonly stage: 'E'; readonly outgoingDuration: number };

export type Birds2aCellSubdivision = {
  readonly owner: Birds2aCell;
  readonly children: readonly [Birds2aCell, Birds2aCell];
} & (
  | { readonly kind: 'expansion'; readonly projection: ExpansionFrameProjection }
  | { readonly kind: 'binomial'; readonly probability: 0.5 }
);

export type Birds2aFlowConstruction =
  | { readonly kind: 'expansion'; readonly projection: ExpansionFlowProjection }
  | { readonly kind: 'spatial-reconciliation'; readonly stage: 'H'; readonly subdivisionOwner: Birds2aFlow;
      readonly sourceChildIndex: 0 | 1; readonly destinationChildIndex: 0 | 1 }
  | { readonly kind: 'source-subdivision'; readonly stage: 'G1'; readonly subdivisionOwner: Birds2aCell;
      readonly childIndex: 0 | 1 }
  | { readonly kind: 'destination-subdivision'; readonly stage: 'G2'; readonly subdivisionOwner: Birds2aCell;
      readonly childIndex: 0 | 1 }
  | { readonly kind: 'temporal-aggregation'; readonly stage: 'B' | 'D'; readonly leg: 'first' | 'second';
      readonly parentDuration: number; readonly enclosingStartTime: number; readonly enclosingEndTime: number };

export interface Birds2aScale {
  readonly cellWidth: number;
  readonly duration: number;
  readonly halfDuration: number;
  readonly quarterDuration: number;
}

/** No fixed coarse ceiling: expansion and contraction share the dyadic spatial grid. */
export function birds2aScale(width: number): Birds2aScale | undefined {
  const exponent = Math.log2(width), duration = EXPANSION_TIME_PER_WIDTH_SQUARED * width ** 2;
  if (!Number.isInteger(exponent) || 2 ** exponent !== width ||
    !Number.isFinite(duration) || duration / 4 <= 0) return undefined;
  return { cellWidth: width, duration, halfDuration: duration / 2, quarterDuration: duration / 4 };
}

export function classifyBirds2aCellGeometry(cell: Birds2aCell): Birds2aScale | undefined {
  const scale = birds2aScale(cell.max - cell.min);
  if (!scale || !Number.isFinite(cell.min) || !Number.isFinite(cell.max) || !Number.isFinite(cell.time) ||
    !Number.isInteger(cell.min / scale.cellWidth) || !Number.isInteger(cell.time / scale.quarterDuration)) return undefined;
  return scale;
}

/** Pure geometry only. Classification never examines population, seed, or cache state.
 * `origin` is the already-validated origin of the owning expansion model. */
export function classifyBirds2aCell(cell: Birds2aCell, origin: ExpansionCell): Birds2aCellConstruction | undefined {
  const scale = classifyBirds2aCellGeometry(cell);
  if (!scale) return undefined;
  const projection = expansionFrameAt(cell.time, origin.max - origin.min);
  if (projection && scale.cellWidth >= projection.cellWidth) return { kind: 'expansion', projection };
  if (Number.isInteger(cell.time / scale.duration)) {
    return { kind: 'spatial-child', stage: 'F', subdivisionOwner: parent(cell), childIndex: childIndex(cell) };
  }
  return { kind: 'temporal-aggregation', stage: 'E', outgoingDuration: scale.quarterDuration };
}

/** Classify the whole F batch, not just its entries: retained child counts must
 * never be replaced by an independent binomial split of their parent. */
export function classifyBirds2aCellSubdivision(cell: Birds2aCell, origin: ExpansionCell): Birds2aCellSubdivision | undefined {
  const scale = classifyBirds2aCellGeometry(cell);
  if (!scale) return undefined;
  const middle = cell.min + scale.cellWidth / 2;
  const children = [
    { min: cell.min, max: middle, time: cell.time },
    { min: middle, max: cell.max, time: cell.time },
  ] as const;
  const projection = expansionFrameAt(cell.time, origin.max - origin.min);
  return projection && scale.cellWidth / 2 >= projection.cellWidth
    ? { kind: 'expansion', owner: cell, children, projection }
    : { kind: 'binomial', owner: cell, children, probability: 0.5 };
}

/** Legal flow geometry only: no expansion lookup or refinement-owner allocation.
 * Shared by the channel and composite, whose legal lattices are identical. */
export function classifyBirds2FlowGeometry(flow: Birds2aFlow) {
  const source = classifyBirds2aCellGeometry(flow.source), destination = classifyBirds2aCellGeometry(flow.destination);
  const duration = flow.destination.time - flow.source.time;
  if (!source || !destination || !(duration > 0) || !Number.isFinite(duration) ||
    !Number.isInteger(flow.source.time / duration)) return undefined;
  const equalWidth = source.cellWidth === destination.cellWidth;
  if (equalWidth ? ![source.duration, source.halfDuration, source.quarterDuration].includes(duration)
    : !((source.cellWidth === 2 * destination.cellWidth && duration === destination.duration) ||
        (destination.cellWidth === 2 * source.cellWidth && duration === source.duration))) return undefined;

  return { source, destination, duration, equalWidth };
}

export function classifyBirds2aFlow(flow: Birds2aFlow, origin: ExpansionCell): Birds2aFlowConstruction | undefined {
  const geometry = classifyBirds2FlowGeometry(flow);
  if (!geometry) return undefined;
  const { source, destination, duration, equalWidth } = geometry;
  const projection = expansionFlow(flow, origin.max - origin.min);
  if (projection) return { kind: 'expansion', projection };
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

/** Checked ownership predicate, without constructing a flow projection or parents. */
export function isBirds2aExpansionFlow(flow: Birds2aFlow, origin: ExpansionCell): boolean {
  if (!classifyBirds2FlowGeometry(flow)) return false;
  const backwards = flow.destination.time <= 0;
  const inner = backwards ? flow.destination : flow.source;
  const outer = backwards ? flow.source : flow.destination;
  const originWidth = origin.max - origin.min;
  if (inner.time === 0) {
    if (inner.max - inner.min < originWidth) return false;
    const location = shellAt(Math.abs(outer.time), originWidth);
    if (!location || !Number.isInteger(location.slot)) return false;
    const width = location.slot === 1 && location.epoch > 0 ? location.cellWidth / 2 : location.cellWidth;
    return outer.max - outer.min >= width;
  }
  const location = shellAt(Math.abs(inner.time), originWidth);
  if (!location || !Number.isInteger(location.slot) || inner.max - inner.min < location.cellWidth ||
    outer.max - outer.min < location.cellWidth) return false;
  const slot = Math.abs(outer.time) / location.duration;
  return Number.isInteger(slot) && slot > location.slot && slot <= 4 &&
    ((location.slot === 2 && slot === 4) || slot === location.slot + 1);
}

function expansionFrameAt(time: number, originWidth: number): ExpansionFrameProjection | undefined {
  if (time === 0) return { kind: 'initial-origin', epoch: 0, cellWidth: originWidth };
  const location = shellAt(Math.abs(time), originWidth);
  if (!location || !Number.isInteger(location.slot)) return undefined;
  const branch = time > 0 ? 'forward' : 'backward';
  if (location.slot === 1) {
    return location.epoch === 0
      ? { kind: 'initial-endpoint', epoch: 0, cellWidth: originWidth, branch }
      : { kind: 'extension-frame', epoch: location.epoch, cellWidth: location.cellWidth / 2, branch, slot: 4 };
  }
  return { kind: 'extension-frame', epoch: location.epoch + 1, cellWidth: location.cellWidth,
    branch, slot: location.slot as 2 | 3 };
}

function expansionFlow(flow: Birds2aFlow, originWidth: number): ExpansionFlowProjection | undefined {
  // Orient towards increasing |t|; public flows always remain chronological.
  const backwards = flow.destination.time <= 0;
  const inner = backwards ? flow.destination : flow.source;
  const outer = backwards ? flow.source : flow.destination;
  if (inner.time === 0) {
    const frame = expansionFrameAt(outer.time, originWidth);
    if (frame && inner.max - inner.min >= originWidth && outer.max - outer.min >= frame.cellWidth) {
      return { kind: 'origin-endpoint', originCell: inner, endpointCell: outer, frame };
    }
    return undefined;
  }
  const location = shellAt(Math.abs(inner.time), originWidth);
  if (!location || !Number.isInteger(location.slot) || inner.max - inner.min < location.cellWidth ||
    outer.max - outer.min < location.cellWidth) return undefined;
  const outerSlot = Math.abs(outer.time) / location.duration;
  if (!Number.isInteger(outerSlot) || outerSlot <= location.slot || outerSlot > 4) return undefined;
  const branch = backwards ? 'backward' : 'forward';
  if (location.slot === 2 && outerSlot === 4) {
    return { kind: 'extension-half', epoch: location.epoch + 1, branch, innerCell: inner, outerCell: outer };
  }
  if (outerSlot !== location.slot + 1) return undefined;
  return { kind: 'extension-step', epoch: location.epoch + 1, branch,
    innerCell: inner, outerCell: outer, stepIndex: (location.slot - 1) as 0 | 1 | 2 };
}

/** Expansion shells [T,4T], with the common boundary assigned to the next shell. */
function shellAt(time: number, originWidth: number) {
  const baseExponent = Math.log2(originWidth);
  const epoch = Math.floor((Math.log2(time / EXPANSION_TIME_PER_WIDTH_SQUARED) - 2 * baseExponent) / 2);
  if (!Number.isFinite(epoch) || epoch < 0) return undefined;
  const cellWidth = 2 ** (baseExponent + epoch), duration = EXPANSION_TIME_PER_WIDTH_SQUARED * cellWidth ** 2;
  const slot = time / duration;
  if (slot < 1 || slot >= 4) return undefined;
  return { epoch, cellWidth, duration, slot };
}

function parent(cell: Birds2aCell): Birds2aCell {
  const width = 2 * (cell.max - cell.min), min = Math.floor(cell.min / width) * width;
  return { min: min === 0 ? 0 : min, max: min + width, time: cell.time };
}
function childIndex(cell: Birds2aCell): 0 | 1 {
  const index = cell.min / (cell.max - cell.min);
  return ((index % 2 + 2) % 2) as 0 | 1;
}
