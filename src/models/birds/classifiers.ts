import {
  cellLength,
  flowDuration,
  type BirdCell,
  type BirdFlow,
  type BirdTwoStageFlow,
} from './entities';
import {
  birdsScale,
  epochForCellLength,
  euclideanModulo,
  isAligned,
  type BirdsScale,
} from './scales';

export interface FlowSearchFromSource {
  readonly kind: 'destinations-from-source';
  readonly sourceCell: BirdCell;
  readonly midpointCell: BirdCell;
  readonly destinationTime: number;
}

export interface FlowSearchToDestination {
  readonly kind: 'sources-to-destination';
  readonly sourceTime: number;
  readonly midpointCell: BirdCell;
  readonly destinationCell: BirdCell;
}

export type ParentFlowSearch = FlowSearchFromSource | FlowSearchToDestination;

export type CellConstruction =
  | {
      readonly kind: 'coarse-initialized';
      readonly epoch: 0;
      readonly stage: 'initialization';
      readonly outgoingDuration: number;
    }
  | {
      readonly kind: 'spatial-child';
      readonly epoch: number;
      readonly stage: 'F';
      readonly parentCell: BirdCell;
      readonly childIndex: 0 | 1;
      readonly subdivisionOwner: BirdCell;
    }
  | {
      readonly kind: 'temporally-introduced';
      readonly epoch: number;
      readonly stage: 'E';
      readonly outgoingDuration: number;
      readonly outflowSource: BirdCell;
    };

export type FlowConstruction =
  | {
      readonly kind: 'coarse-initialized';
      readonly epoch: 0;
      readonly stage: 'initialization';
      readonly coarseKernelOffset: number;
    }
  | {
      readonly kind: 'temporal-aggregation';
      readonly epoch: number;
      readonly stage: 'B' | 'D';
      readonly leg: 'first' | 'second';
      readonly enclosingStartTime: number;
      readonly enclosingEndTime: number;
      readonly parentDuration: number;
      readonly parentFlowSearch: ParentFlowSearch;
    }
  | {
      readonly kind: 'source-spatial-child';
      readonly epoch: number;
      readonly stage: 'G1';
      readonly sourceParentCell: BirdCell;
      readonly sourceChildIndex: 0 | 1;
      readonly subdivisionOwner: BirdCell;
    }
  | {
      readonly kind: 'destination-spatial-child';
      readonly epoch: number;
      readonly stage: 'G2';
      readonly destinationParentCell: BirdCell;
      readonly destinationChildIndex: 0 | 1;
      readonly subdivisionOwner: BirdCell;
    }
  | {
      readonly kind: 'fully-spatially-refined';
      readonly epoch: number;
      readonly stage: 'H';
      readonly containingFlow: BirdFlow;
      readonly sourceChildIndex: 0 | 1;
      readonly destinationChildIndex: 0 | 1;
      readonly subdivisionOwner: BirdFlow;
    };

export type TwoStageFlowConstruction =
  | {
      readonly kind: 'epoch-time-subdivision';
      readonly epoch: number;
      readonly stage: 'A';
      readonly parentFlow: BirdFlow;
      readonly midpointCell: BirdCell;
      readonly normalizedDuration: 1;
    }
  | {
      readonly kind: 'half-flow-time-subdivision';
      readonly epoch: number;
      readonly stage: 'C';
      readonly parentFlow: BirdFlow;
      readonly midpointCell: BirdCell;
      readonly normalizedDuration: 0.5;
    };

export function classifyCell(cell: BirdCell): CellConstruction | undefined {
  const scale = classifyCellGeometry(cell);
  if (scale === undefined || !isAligned(cell.time, scale.nextFlowDuration)) return undefined;

  if (scale.epoch === 0 && isAligned(cell.time, scale.flowDuration)) {
    return {
      kind: 'coarse-initialized',
      epoch: 0,
      stage: 'initialization',
      outgoingDuration: scale.flowDuration,
    };
  }

  if (scale.epoch > 0 && isAligned(cell.time, scale.flowDuration)) {
    const parentCell = containingParentCell(cell);
    return {
      kind: 'spatial-child',
      epoch: scale.epoch - 1,
      stage: 'F',
      parentCell,
      childIndex: childIndex(cell),
      subdivisionOwner: parentCell,
    };
  }

  return {
    kind: 'temporally-introduced',
    epoch: scale.epoch,
    stage: 'E',
    outgoingDuration: scale.nextFlowDuration,
    outflowSource: cell,
  };
}

export function classifyFlow(flow: BirdFlow): FlowConstruction | undefined {
  const sourceScale = classifyCellGeometry(flow.source);
  const destinationScale = classifyCellGeometry(flow.destination);
  if (
    sourceScale === undefined ||
    destinationScale === undefined ||
    classifyCell(flow.source) === undefined ||
    classifyCell(flow.destination) === undefined
  ) {
    return undefined;
  }

  const duration = flowDuration(flow);
  if (!Number.isFinite(duration) || duration <= 0 || !isAligned(flow.source.time, duration)) {
    return undefined;
  }

  if (sourceScale.epoch === destinationScale.epoch) {
    return classifyEqualResolutionFlow(flow, sourceScale, duration);
  }

  if (sourceScale.epoch === destinationScale.epoch + 1) {
    const coarseScale = destinationScale;
    if (duration !== coarseScale.nextFlowDuration) return undefined;
    const sourceParentCell = containingParentCell(flow.source);
    return {
      kind: 'source-spatial-child',
      epoch: coarseScale.epoch,
      stage: 'G1',
      sourceParentCell,
      sourceChildIndex: childIndex(flow.source),
      subdivisionOwner: sourceParentCell,
    };
  }

  if (destinationScale.epoch === sourceScale.epoch + 1) {
    const coarseScale = sourceScale;
    if (duration !== coarseScale.nextFlowDuration) return undefined;
    const destinationParentCell = containingParentCell(flow.destination);
    return {
      kind: 'destination-spatial-child',
      epoch: coarseScale.epoch,
      stage: 'G2',
      destinationParentCell,
      destinationChildIndex: childIndex(flow.destination),
      subdivisionOwner: destinationParentCell,
    };
  }

  return undefined;
}

export function classifyTwoStageFlow(
  flow: BirdTwoStageFlow,
): TwoStageFlowConstruction | undefined {
  const sourceScale = classifyCellGeometry(flow.source);
  const midpointScale = classifyCellGeometry(flow.midpoint);
  const destinationScale = classifyCellGeometry(flow.destination);
  if (
    sourceScale === undefined ||
    midpointScale?.epoch !== sourceScale.epoch ||
    destinationScale?.epoch !== sourceScale.epoch ||
    classifyCell(flow.source) === undefined ||
    classifyCell(flow.midpoint) === undefined ||
    classifyCell(flow.destination) === undefined
  ) {
    return undefined;
  }

  const duration = flow.destination.time - flow.source.time;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    flow.midpoint.time !== flow.source.time + duration / 2 ||
    !isAligned(flow.source.time, duration)
  ) {
    return undefined;
  }

  const parentFlow = { source: flow.source, destination: flow.destination };
  const parentConstruction = classifyFlow(parentFlow);
  if (duration === sourceScale.flowDuration && isEntryFlow(parentConstruction)) {
    return {
      kind: 'epoch-time-subdivision',
      epoch: sourceScale.epoch,
      stage: 'A',
      parentFlow,
      midpointCell: flow.midpoint,
      normalizedDuration: 1,
    };
  }
  if (
    duration === sourceScale.halfFlowDuration &&
    parentConstruction?.kind === 'temporal-aggregation' &&
    parentConstruction.stage === 'B'
  ) {
    return {
      kind: 'half-flow-time-subdivision',
      epoch: sourceScale.epoch,
      stage: 'C',
      parentFlow,
      midpointCell: flow.midpoint,
      normalizedDuration: 0.5,
    };
  }

  return undefined;
}

function classifyEqualResolutionFlow(
  flow: BirdFlow,
  scale: BirdsScale,
  duration: number,
): FlowConstruction | undefined {
  if (duration === scale.flowDuration) {
    if (scale.epoch === 0) {
      return {
        kind: 'coarse-initialized',
        epoch: 0,
        stage: 'initialization',
        coarseKernelOffset: spatialIndex(flow.destination) - spatialIndex(flow.source),
      };
    }

    const containingFlow = {
      source: containingParentCell(flow.source),
      destination: containingParentCell(flow.destination),
    };
    return {
      kind: 'fully-spatially-refined',
      epoch: scale.epoch - 1,
      stage: 'H',
      containingFlow,
      sourceChildIndex: childIndex(flow.source),
      destinationChildIndex: childIndex(flow.destination),
      subdivisionOwner: containingFlow,
    };
  }

  if (duration === scale.halfFlowDuration) {
    return temporalAggregation(flow, scale.epoch, 'B', duration);
  }
  if (duration === scale.nextFlowDuration) {
    return temporalAggregation(flow, scale.epoch, 'D', duration);
  }
  return undefined;
}

function temporalAggregation(
  flow: BirdFlow,
  epoch: number,
  stage: 'B' | 'D',
  duration: number,
): FlowConstruction {
  const intervalIndex = flow.source.time / duration;
  const firstLeg = euclideanModulo(intervalIndex, 2) === 0;
  const enclosingStartTime = firstLeg ? flow.source.time : flow.source.time - duration;
  const enclosingEndTime = enclosingStartTime + 2 * duration;
  const parentFlowSearch: ParentFlowSearch = firstLeg
    ? {
        kind: 'destinations-from-source',
        sourceCell: flow.source,
        midpointCell: flow.destination,
        destinationTime: enclosingEndTime,
      }
    : {
        kind: 'sources-to-destination',
        sourceTime: enclosingStartTime,
        midpointCell: flow.source,
        destinationCell: flow.destination,
      };

  return {
    kind: 'temporal-aggregation',
    epoch,
    stage,
    leg: firstLeg ? 'first' : 'second',
    enclosingStartTime,
    enclosingEndTime,
    parentDuration: 2 * duration,
    parentFlowSearch,
  };
}

function classifyCellGeometry(cell: BirdCell): BirdsScale | undefined {
  if (
    !Number.isFinite(cell.min) ||
    !Number.isFinite(cell.max) ||
    !Number.isFinite(cell.time)
  ) {
    return undefined;
  }
  const epoch = epochForCellLength(cellLength(cell));
  const scale = epoch === undefined ? undefined : birdsScale(epoch);
  if (scale === undefined || !isAligned(cell.min, scale.cellLength)) return undefined;
  return scale;
}

function containingParentCell(cell: BirdCell): BirdCell {
  const length = cellLength(cell);
  const parentLength = 2 * length;
  const min = Math.floor(cell.min / parentLength) * parentLength;
  return { min, max: min + parentLength, time: cell.time };
}

function childIndex(cell: BirdCell): 0 | 1 {
  return euclideanModulo(spatialIndex(cell), 2) as 0 | 1;
}

function spatialIndex(cell: BirdCell): number {
  return cell.min / cellLength(cell);
}

function isEntryFlow(construction: FlowConstruction | undefined): boolean {
  return (
    construction?.kind === 'coarse-initialized' ||
    construction?.kind === 'fully-spatially-refined'
  );
}
