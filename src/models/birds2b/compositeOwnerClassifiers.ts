import {
  classifyCompositeCellGeometry, classifyCompositeFlow,
  type CompositeCell, type CompositeFlow,
} from './compositeClassifiers';

type SpatialConstruction = { readonly kind: 'channel-merge' } | { readonly kind: 'hypergeometric' };

export type CompositeTimeSubdivision = {
  readonly kind: 'multinomial';
  readonly ownerFlow: CompositeFlow;
  readonly stage: 'A' | 'C';
  readonly midpointTime: number;
  readonly midpointCellWidth: number;
  readonly normalizedDuration: 1 | 0.5;
};

export type CompositeIncidenceSubdivision = {
  readonly ownerCell: CompositeCell;
  readonly stage: 'G1' | 'G2';
  readonly children: readonly [CompositeCell, CompositeCell];
  readonly oppositeTime: number;
  readonly oppositeCellWidth: number;
  readonly flowDuration: number;
} & SpatialConstruction;

export type CompositeSpaceSubdivision = {
  readonly ownerFlow: CompositeFlow;
  readonly stage: 'H';
  readonly sourceChildren: readonly [CompositeCell, CompositeCell];
  readonly destinationChildren: readonly [CompositeCell, CompositeCell];
  readonly sourceMargins: readonly [CompositeFlow, CompositeFlow];
  readonly destinationMargins: readonly [CompositeFlow, CompositeFlow];
  readonly childFlows: readonly [CompositeFlow, CompositeFlow, CompositeFlow, CompositeFlow];
} & SpatialConstruction;

/** A/C ownership depends on geometry, not on how the parent flow was made. */
export function classifyCompositeFlowTimeSubdivision(
  flow: CompositeFlow,
): CompositeTimeSubdivision | undefined {
  const scale = classifyCompositeCellGeometry(flow.source);
  if (!scale || !classifyCompositeFlow(flow) ||
    flow.destination.max - flow.destination.min !== scale.cellWidth) return undefined;
  const duration = flow.destination.time - flow.source.time;
  if (duration !== scale.duration && duration !== scale.halfDuration) return undefined;
  const midpointTime = flow.source.time + duration / 2;
  const midpoint = { min: 0, max: scale.cellWidth, time: midpointTime };
  // Merge coverage depends only on times and widths, not spatial indices.
  const retained = isChannelMerge({ source: flow.source, destination: midpoint }) &&
    isChannelMerge({ source: midpoint, destination: flow.destination });
  // Ordinary leg queries must terminate at channel merges, never request a new joint.
  if (retained) throw new Error('Temporal subdivision must not be evaluated: channel merging supplies both legs');
  return { kind: 'multinomial', ownerFlow: flow,
    stage: duration === scale.duration ? 'A' : 'C', midpointTime,
    midpointCellWidth: scale.cellWidth, normalizedDuration: duration === scale.duration ? 1 : 0.5 };
}

export function classifyCompositeOutflowSubdivision(
  cell: CompositeCell,
): CompositeIncidenceSubdivision | undefined {
  return incidence(cell, 'G1');
}

export function classifyCompositeInflowSubdivision(
  cell: CompositeCell,
): CompositeIncidenceSubdivision | undefined {
  return incidence(cell, 'G2');
}

function incidence(cell: CompositeCell, stage: 'G1' | 'G2'): CompositeIncidenceSubdivision | undefined {
  const scale = classifyCompositeCellGeometry(cell);
  if (!scale) return undefined;
  const children = subdivide(cell);
  const oppositeTime = cell.time + (stage === 'G1' ? scale.quarterDuration : -scale.quarterDuration);
  const opposite = { min: 0, max: scale.cellWidth, time: oppositeTime };
  const probe = stage === 'G1' ? { source: children[0], destination: opposite }
    : { source: opposite, destination: children[0] };
  return { kind: isChannelMerge(probe) ? 'channel-merge' : 'hypergeometric',
    ownerCell: cell, stage, children, oppositeTime, oppositeCellWidth: scale.cellWidth,
    flowDuration: scale.quarterDuration };
}

/** Whole H batches either retrieve their four entries or reconcile G1/G2 margins. */
export function classifyCompositeFlowSpaceSubdivision(
  flow: CompositeFlow,
): CompositeSpaceSubdivision | undefined {
  const scale = classifyCompositeCellGeometry(flow.source);
  if (!scale || !classifyCompositeFlow(flow) ||
    flow.destination.max - flow.destination.min !== scale.cellWidth ||
    flow.destination.time - flow.source.time !== scale.quarterDuration) return undefined;
  const sourceChildren = subdivide(flow.source), destinationChildren = subdivide(flow.destination);
  const sourceMargins = [
    { source: sourceChildren[0], destination: flow.destination },
    { source: sourceChildren[1], destination: flow.destination },
  ] as const;
  const destinationMargins = [
    { source: flow.source, destination: destinationChildren[0] },
    { source: flow.source, destination: destinationChildren[1] },
  ] as const;
  const childFlows = [
    { source: sourceChildren[0], destination: destinationChildren[0] },
    { source: sourceChildren[0], destination: destinationChildren[1] },
    { source: sourceChildren[1], destination: destinationChildren[0] },
    { source: sourceChildren[1], destination: destinationChildren[1] },
  ] as const;
  return { kind: isChannelMerge(childFlows[0]) ? 'channel-merge' : 'hypergeometric',
    stage: 'H', ownerFlow: flow, sourceChildren, destinationChildren, sourceMargins, destinationMargins, childFlows };
}

function isChannelMerge(flow: CompositeFlow): boolean {
  return classifyCompositeFlow(flow)?.kind === 'channel-merge';
}

function subdivide(cell: CompositeCell): readonly [CompositeCell, CompositeCell] {
  const middle = (cell.min + cell.max) / 2;
  return [{ min: cell.min, max: middle, time: cell.time }, { min: middle, max: cell.max, time: cell.time }];
}
