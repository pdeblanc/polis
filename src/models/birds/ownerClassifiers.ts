import { classifyCell, classifyFlow } from './classifiers';
import { cellLength, flowDuration, type BirdCell, type BirdFlow } from './entities';
import { birdsScale, epochForCellLength } from './scales';

export type FlowTimeSubdivisionOwner =
  | {
      readonly kind: 'epoch-flow-time-subdivision';
      readonly epoch: number;
      readonly stage: 'A';
      readonly ownerFlow: BirdFlow;
      readonly midpointTime: number;
      readonly midpointCellLength: number;
      readonly normalizedDuration: 1;
    }
  | {
      readonly kind: 'half-flow-time-subdivision';
      readonly epoch: number;
      readonly stage: 'C';
      readonly ownerFlow: BirdFlow;
      readonly midpointTime: number;
      readonly midpointCellLength: number;
      readonly normalizedDuration: 0.5;
    };

export interface CellSubdivisionOwner {
  readonly kind: 'cell-subdivision';
  readonly epoch: number;
  readonly stage: 'F';
  readonly ownerCell: BirdCell;
  readonly children: readonly [BirdCell, BirdCell];
}

export interface CellOutflowSubdivisionOwner {
  readonly kind: 'cell-outflow-subdivision';
  readonly epoch: number;
  readonly stage: 'G1';
  readonly ownerCell: BirdCell;
  readonly sourceChildren: readonly [BirdCell, BirdCell];
  readonly flowDuration: number;
  readonly destinationCellLength: number;
  readonly destinationTime: number;
}

export interface CellInflowSubdivisionOwner {
  readonly kind: 'cell-inflow-subdivision';
  readonly epoch: number;
  readonly stage: 'G2';
  readonly ownerCell: BirdCell;
  readonly destinationChildren: readonly [BirdCell, BirdCell];
  readonly flowDuration: number;
  readonly sourceCellLength: number;
  readonly sourceTime: number;
}

export interface FlowSpaceSubdivisionOwner {
  readonly kind: 'flow-space-subdivision';
  readonly epoch: number;
  readonly stage: 'H';
  readonly ownerFlow: BirdFlow;
  readonly sourceChildren: readonly [BirdCell, BirdCell];
  readonly destinationChildren: readonly [BirdCell, BirdCell];
  readonly childFlows: readonly [BirdFlow, BirdFlow, BirdFlow, BirdFlow];
}

/** Classifies whether an equal-resolution flow owns a Stage-A or Stage-C split. */
export function classifyFlowTimeSubdivisionOwner(
  flow: BirdFlow,
): FlowTimeSubdivisionOwner | undefined {
  const epoch = epochForEqualResolutionFlow(flow);
  const scale = epoch === undefined ? undefined : birdsScale(epoch);
  const construction = classifyFlow(flow);
  if (epoch === undefined || scale === undefined || construction === undefined) return undefined;

  const duration = flowDuration(flow);
  const midpointTime = flow.source.time + duration / 2;
  if (
    duration === scale.flowDuration &&
    (construction.kind === 'coarse-initialized' ||
      construction.kind === 'fully-spatially-refined')
  ) {
    return {
      kind: 'epoch-flow-time-subdivision',
      epoch,
      stage: 'A',
      ownerFlow: flow,
      midpointTime,
      midpointCellLength: scale.cellLength,
      normalizedDuration: 1,
    };
  }

  if (
    duration === scale.halfFlowDuration &&
    construction.kind === 'temporal-aggregation' &&
    construction.stage === 'B'
  ) {
    return {
      kind: 'half-flow-time-subdivision',
      epoch,
      stage: 'C',
      ownerFlow: flow,
      midpointTime,
      midpointCellLength: scale.cellLength,
      normalizedDuration: 0.5,
    };
  }

  return undefined;
}

/** Every legal cell owns its next inward spatial split, regardless of construction. */
export function classifyCellSubdivisionOwner(
  cell: BirdCell,
): CellSubdivisionOwner | undefined {
  const facts = cellOwnerFacts(cell);
  if (facts === undefined) return undefined;
  return {
    kind: 'cell-subdivision',
    epoch: facts.epoch,
    stage: 'F',
    ownerCell: cell,
    children: facts.children,
  };
}

/** Every legal cell owns the joint source-side split of its next-duration outflows. */
export function classifyCellOutflowSubdivisionOwner(
  cell: BirdCell,
): CellOutflowSubdivisionOwner | undefined {
  const facts = cellOwnerFacts(cell);
  if (facts === undefined) return undefined;
  return {
    kind: 'cell-outflow-subdivision',
    epoch: facts.epoch,
    stage: 'G1',
    ownerCell: cell,
    sourceChildren: facts.children,
    flowDuration: facts.nextFlowDuration,
    destinationCellLength: facts.cellLength,
    destinationTime: cell.time + facts.nextFlowDuration,
  };
}

/** Every legal cell owns the joint destination-side split of its next-duration inflows. */
export function classifyCellInflowSubdivisionOwner(
  cell: BirdCell,
): CellInflowSubdivisionOwner | undefined {
  const facts = cellOwnerFacts(cell);
  if (facts === undefined) return undefined;
  return {
    kind: 'cell-inflow-subdivision',
    epoch: facts.epoch,
    stage: 'G2',
    ownerCell: cell,
    destinationChildren: facts.children,
    flowDuration: facts.nextFlowDuration,
    sourceCellLength: facts.cellLength,
    sourceTime: cell.time - facts.nextFlowDuration,
  };
}

/** A legal Stage-D flow owns the complete 2 x 2 Stage-H reconciliation. */
export function classifyFlowSpaceSubdivisionOwner(
  flow: BirdFlow,
): FlowSpaceSubdivisionOwner | undefined {
  const epoch = epochForEqualResolutionFlow(flow);
  const scale = epoch === undefined ? undefined : birdsScale(epoch);
  const construction = classifyFlow(flow);
  if (
    epoch === undefined ||
    scale === undefined ||
    flowDuration(flow) !== scale.nextFlowDuration ||
    construction?.kind !== 'temporal-aggregation' ||
    construction.stage !== 'D'
  ) {
    return undefined;
  }

  const sourceChildren = subdivideCell(flow.source);
  const destinationChildren = subdivideCell(flow.destination);
  return {
    kind: 'flow-space-subdivision',
    epoch,
    stage: 'H',
    ownerFlow: flow,
    sourceChildren,
    destinationChildren,
    childFlows: [
      { source: sourceChildren[0], destination: destinationChildren[0] },
      { source: sourceChildren[0], destination: destinationChildren[1] },
      { source: sourceChildren[1], destination: destinationChildren[0] },
      { source: sourceChildren[1], destination: destinationChildren[1] },
    ],
  };
}

interface CellOwnerFacts {
  readonly epoch: number;
  readonly cellLength: number;
  readonly nextFlowDuration: number;
  readonly children: readonly [BirdCell, BirdCell];
}

function cellOwnerFacts(cell: BirdCell): CellOwnerFacts | undefined {
  if (classifyCell(cell) === undefined) return undefined;
  const epoch = epochForCellLength(cellLength(cell));
  const scale = epoch === undefined ? undefined : birdsScale(epoch);
  if (epoch === undefined || scale === undefined) return undefined;
  return {
    epoch,
    cellLength: scale.cellLength,
    nextFlowDuration: scale.nextFlowDuration,
    children: subdivideCell(cell),
  };
}

function epochForEqualResolutionFlow(flow: BirdFlow): number | undefined {
  const sourceEpoch = epochForCellLength(cellLength(flow.source));
  const destinationEpoch = epochForCellLength(cellLength(flow.destination));
  return sourceEpoch === destinationEpoch ? sourceEpoch : undefined;
}

function subdivideCell(cell: BirdCell): readonly [BirdCell, BirdCell] {
  const midpoint = cell.min + cellLength(cell) / 2;
  return [
    { min: cell.min, max: midpoint, time: cell.time },
    { min: midpoint, max: cell.max, time: cell.time },
  ];
}
