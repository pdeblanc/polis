import type { ExpansionCell } from './expansion';
import {
  classifyBirds2aCellGeometry, isBirds2aExpansionFlow,
  classifyBirds2FlowGeometry, type Birds2aCell, type Birds2aFlow,
} from './classifiers';

type SpatialConstruction = { readonly kind: 'expansion' } | { readonly kind: 'hypergeometric' };

export type Birds2aTimeSubdivision = {
  readonly kind: 'multinomial';
  readonly ownerFlow: Birds2aFlow;
  readonly stage: 'A' | 'C';
  readonly midpointTime: number;
  readonly midpointCellWidth: number;
  readonly normalizedDuration: 1 | 0.5;
};

export type Birds2aIncidenceSubdivision = {
  readonly ownerCell: Birds2aCell;
  readonly stage: 'G1' | 'G2';
  readonly children: readonly [Birds2aCell, Birds2aCell];
  readonly oppositeTime: number;
  readonly oppositeCellWidth: number;
  readonly flowDuration: number;
} & SpatialConstruction;

export type Birds2aSpaceSubdivision = {
  readonly ownerFlow: Birds2aFlow;
  readonly stage: 'H';
  readonly sourceChildren: readonly [Birds2aCell, Birds2aCell];
  readonly destinationChildren: readonly [Birds2aCell, Birds2aCell];
  readonly sourceMargins: readonly [Birds2aFlow, Birds2aFlow];
  readonly destinationMargins: readonly [Birds2aFlow, Birds2aFlow];
  readonly childFlows: readonly [Birds2aFlow, Birds2aFlow, Birds2aFlow, Birds2aFlow];
} & SpatialConstruction;

/** A/C ownership depends on geometry, not on how the parent flow was made. */
export function classifyBirds2aFlowTimeSubdivision(
  flow: Birds2aFlow, origin: ExpansionCell,
): Birds2aTimeSubdivision | undefined {
  const geometry = classifyBirds2FlowGeometry(flow);
  if (!geometry || !geometry.equalWidth) return undefined;
  const scale = geometry.source, duration = geometry.duration;
  if (duration !== scale.duration && duration !== scale.halfDuration) return undefined;
  const midpointTime = flow.source.time + duration / 2;
  const midpoint = { min: 0, max: scale.cellWidth, time: midpointTime };
  // Expansion coverage depends only on times and widths, not spatial indices.
  const retained = isExpansion({ source: flow.source, destination: midpoint }, origin) &&
    isExpansion({ source: midpoint, destination: flow.destination }, origin);
  // Ordinary leg queries must terminate at expansion, never request a new joint.
  if (retained) throw new Error('Temporal subdivision must not be evaluated: expansion supplies both legs');
  return { kind: 'multinomial', ownerFlow: flow,
    stage: duration === scale.duration ? 'A' : 'C', midpointTime,
    midpointCellWidth: scale.cellWidth, normalizedDuration: duration === scale.duration ? 1 : 0.5 };
}

export function classifyBirds2aOutflowSubdivision(
  cell: Birds2aCell, origin: ExpansionCell,
): Birds2aIncidenceSubdivision | undefined {
  return incidence(cell, origin, 'G1');
}

export function classifyBirds2aInflowSubdivision(
  cell: Birds2aCell, origin: ExpansionCell,
): Birds2aIncidenceSubdivision | undefined {
  return incidence(cell, origin, 'G2');
}

function incidence(cell: Birds2aCell, origin: ExpansionCell, stage: 'G1' | 'G2'): Birds2aIncidenceSubdivision | undefined {
  const scale = classifyBirds2aCellGeometry(cell);
  if (!scale) return undefined;
  const children = subdivide(cell);
  const oppositeTime = cell.time + (stage === 'G1' ? scale.quarterDuration : -scale.quarterDuration);
  const opposite = { min: 0, max: scale.cellWidth, time: oppositeTime };
  const probe = stage === 'G1' ? { source: children[0], destination: opposite }
    : { source: opposite, destination: children[0] };
  return { kind: isExpansion(probe, origin) ? 'expansion' : 'hypergeometric',
    ownerCell: cell, stage, children, oppositeTime, oppositeCellWidth: scale.cellWidth,
    flowDuration: scale.quarterDuration };
}

/** Whole H batches either retrieve their four entries or reconcile G1/G2 margins. */
export function classifyBirds2aFlowSpaceSubdivision(
  flow: Birds2aFlow, origin: ExpansionCell,
): Birds2aSpaceSubdivision | undefined {
  const scale = classifyBirds2aCellGeometry(flow.source);
  if (!scale || !classifyBirds2FlowGeometry(flow) ||
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
  return { kind: isExpansion(childFlows[0], origin) ? 'expansion' : 'hypergeometric',
    stage: 'H', ownerFlow: flow, sourceChildren, destinationChildren, sourceMargins, destinationMargins, childFlows };
}

function isExpansion(flow: Birds2aFlow, origin: ExpansionCell): boolean {
  return isBirds2aExpansionFlow(flow, origin);
}

function subdivide(cell: Birds2aCell): readonly [Birds2aCell, Birds2aCell] {
  const middle = (cell.min + cell.max) / 2;
  return [{ min: cell.min, max: middle, time: cell.time }, { min: middle, max: cell.max, time: cell.time }];
}
