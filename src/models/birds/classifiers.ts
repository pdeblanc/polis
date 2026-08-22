import {
  flowDuration,
  type BirdCell,
  type BirdFlow,
  type BirdTwoStageFlow,
} from './entities';
import {
  BIRDS_COARSE_CELL_LENGTH,
  BIRDS_COARSE_FLOW_DURATION,
  euclideanModulo,
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
  if (scale === undefined || !Number.isInteger(cell.time / scale.nextFlowDuration)) {
    return undefined;
  }

  if (scale.epoch === 0 && Number.isInteger(cell.time / scale.flowDuration)) {
    return {
      kind: 'coarse-initialized',
      epoch: 0,
      stage: 'initialization',
      outgoingDuration: scale.flowDuration,
    };
  }

  if (scale.epoch > 0 && Number.isInteger(cell.time / scale.flowDuration)) {
    const parentLength = 2 * scale.cellLength;
    const parentMin = Math.floor(cell.min / parentLength) * parentLength;
    const parentCell = { min: parentMin, max: parentMin + parentLength, time: cell.time };
    return {
      kind: 'spatial-child',
      epoch: scale.epoch - 1,
      stage: 'F',
      parentCell,
      childIndex: euclideanModulo(cell.min / scale.cellLength, 2) as 0 | 1,
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
    !Number.isInteger(flow.source.time / sourceScale.nextFlowDuration) ||
    !Number.isInteger(flow.destination.time / destinationScale.nextFlowDuration)
  ) {
    return undefined;
  }

  const duration = flowDuration(flow);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isInteger(flow.source.time / duration)
  ) {
    return undefined;
  }

  return classifyFlowFromValidCells(flow, sourceScale, destinationScale, duration);
}

function classifyFlowFromValidCells(
  flow: BirdFlow,
  sourceScale: BirdsScale,
  destinationScale: BirdsScale,
  duration: number,
): FlowConstruction | undefined {
  if (sourceScale.epoch === destinationScale.epoch) {
    if (duration === sourceScale.flowDuration) {
      const sourceIndex = flow.source.min / sourceScale.cellLength;
      const destinationIndex = flow.destination.min / destinationScale.cellLength;
      if (sourceScale.epoch === 0) {
        return {
          kind: 'coarse-initialized',
          epoch: 0,
          stage: 'initialization',
          coarseKernelOffset: destinationIndex - sourceIndex,
        };
      }

      const parentLength = 2 * sourceScale.cellLength;
      const sourceParentMin = Math.floor(flow.source.min / parentLength) * parentLength;
      const destinationParentMin = Math.floor(flow.destination.min / parentLength) * parentLength;
      const containingFlow = {
        source: {
          min: sourceParentMin,
          max: sourceParentMin + parentLength,
          time: flow.source.time,
        },
        destination: {
          min: destinationParentMin,
          max: destinationParentMin + parentLength,
          time: flow.destination.time,
        },
      };
      return {
        kind: 'fully-spatially-refined',
        epoch: sourceScale.epoch - 1,
        stage: 'H',
        containingFlow,
        sourceChildIndex: euclideanModulo(sourceIndex, 2) as 0 | 1,
        destinationChildIndex: euclideanModulo(destinationIndex, 2) as 0 | 1,
        subdivisionOwner: containingFlow,
      };
    }

    const stage =
      duration === sourceScale.halfFlowDuration
        ? 'B'
        : duration === sourceScale.nextFlowDuration
          ? 'D'
          : undefined;
    if (stage === undefined) return undefined;
    const intervalIndex = flow.source.time / duration;
    const firstLeg = euclideanModulo(intervalIndex, 2) === 0;
    const enclosingStartTime = firstLeg ? flow.source.time : flow.source.time - duration;
    const enclosingEndTime = enclosingStartTime + 2 * duration;
    return {
      kind: 'temporal-aggregation',
      epoch: sourceScale.epoch,
      stage,
      leg: firstLeg ? 'first' : 'second',
      enclosingStartTime,
      enclosingEndTime,
      parentDuration: 2 * duration,
      parentFlowSearch: firstLeg
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
          },
    };
  }

  if (sourceScale.epoch === destinationScale.epoch + 1) {
    const coarseScale = destinationScale;
    if (duration !== coarseScale.nextFlowDuration) return undefined;
    const parentLength = 2 * sourceScale.cellLength;
    const parentMin = Math.floor(flow.source.min / parentLength) * parentLength;
    const sourceParentCell = {
      min: parentMin,
      max: parentMin + parentLength,
      time: flow.source.time,
    };
    return {
      kind: 'source-spatial-child',
      epoch: coarseScale.epoch,
      stage: 'G1',
      sourceParentCell,
      sourceChildIndex: euclideanModulo(flow.source.min / sourceScale.cellLength, 2) as 0 | 1,
      subdivisionOwner: sourceParentCell,
    };
  }

  if (destinationScale.epoch === sourceScale.epoch + 1) {
    const coarseScale = sourceScale;
    if (duration !== coarseScale.nextFlowDuration) return undefined;
    const parentLength = 2 * destinationScale.cellLength;
    const parentMin = Math.floor(flow.destination.min / parentLength) * parentLength;
    const destinationParentCell = {
      min: parentMin,
      max: parentMin + parentLength,
      time: flow.destination.time,
    };
    return {
      kind: 'destination-spatial-child',
      epoch: coarseScale.epoch,
      stage: 'G2',
      destinationParentCell,
      destinationChildIndex: euclideanModulo(
        flow.destination.min / destinationScale.cellLength,
        2,
      ) as 0 | 1,
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
    !Number.isInteger(flow.source.time / sourceScale.nextFlowDuration) ||
    !Number.isInteger(flow.midpoint.time / sourceScale.nextFlowDuration) ||
    !Number.isInteger(flow.destination.time / sourceScale.nextFlowDuration)
  ) {
    return undefined;
  }

  const duration = flow.destination.time - flow.source.time;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    flow.midpoint.time !== flow.source.time + duration / 2 ||
    !Number.isInteger(flow.source.time / duration)
  ) {
    return undefined;
  }

  const parentFlow = { source: flow.source, destination: flow.destination };
  const parentConstruction = classifyFlowFromValidCells(
    parentFlow,
    sourceScale,
    destinationScale,
    duration,
  );
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

function classifyCellGeometry(cell: BirdCell): BirdsScale | undefined {
  const length = cell.max - cell.min;
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(cell.time)) {
    return undefined;
  }

  const epoch = Math.log2(BIRDS_COARSE_CELL_LENGTH / length);
  if (!Number.isSafeInteger(epoch) || epoch < 0) return undefined;

  const canonicalLength = BIRDS_COARSE_CELL_LENGTH / 2 ** epoch;
  const flowDuration = BIRDS_COARSE_FLOW_DURATION / 4 ** epoch;
  if (
    length !== canonicalLength ||
    !Number.isFinite(flowDuration) ||
    flowDuration <= 0 ||
    !Number.isInteger(cell.min / canonicalLength)
  ) {
    return undefined;
  }

  return {
    epoch,
    cellLength: canonicalLength,
    childCellLength: canonicalLength / 2,
    flowDuration,
    halfFlowDuration: flowDuration / 2,
    nextFlowDuration: flowDuration / 4,
  };
}

function isEntryFlow(construction: FlowConstruction | undefined): boolean {
  return (
    construction?.kind === 'coarse-initialized' ||
    construction?.kind === 'fully-spatially-refined'
  );
}
