import { classifyCell, classifyFlow, classifyTwoStageFlow } from './classifiers';
import type { BirdsDependencyNode } from './birdsEngine';
import {
  classifyCellInflowSubdivisionOwner,
  classifyCellOutflowSubdivisionOwner,
  classifyCellSubdivisionOwner,
  classifyFlowSpaceSubdivisionOwner,
  classifyFlowTimeSubdivisionOwner,
} from './ownerClassifiers';

/** Diagnostic-only representation of the construction order in one epoch. */
export interface BirdsDependencyRank {
  readonly epoch: number;
  readonly order: number;
  readonly role: 'batch' | 'entry';
}

/**
 * Computes the conceptual rank used to verify acyclicity. Production queries deliberately
 * do not call this function: their dependencies come only from geometry classifiers.
 */
export function birdsDependencyRank(
  node: BirdsDependencyNode,
): BirdsDependencyRank | undefined {
  switch (node.role) {
    case 'cell': {
      const construction = classifyCell(node.cell);
      if (construction === undefined) return undefined;
      if (construction.kind === 'coarse-initialized') return rank(0, 1, 'entry');
      if (construction.kind === 'temporally-introduced') {
        return rank(construction.epoch, 8, 'entry');
      }
      return rank(construction.epoch, 10, 'entry');
    }

    case 'flow': {
      const construction = classifyFlow(node.flow);
      if (construction === undefined) return undefined;
      switch (construction.kind) {
        case 'coarse-initialized':
          return rank(0, 0, 'entry');
        case 'temporal-aggregation':
          return rank(construction.epoch, construction.stage === 'B' ? 4 : 7, 'entry');
        case 'source-spatial-child':
        case 'destination-spatial-child':
          return rank(construction.epoch, 12, 'entry');
        case 'fully-spatially-refined':
          return rank(construction.epoch, 14, 'entry');
      }
      throw new Error('Unreachable flow construction');
    }

    case 'two-stage-flow': {
      const construction = classifyTwoStageFlow(node.flow);
      if (construction === undefined) return undefined;
      return rank(construction.epoch, construction.stage === 'A' ? 3 : 6, 'entry');
    }

    case 'temporal-subdivision': {
      const owner = classifyFlowTimeSubdivisionOwner(node.flow);
      if (owner === undefined) return undefined;
      return rank(owner.epoch, owner.stage === 'A' ? 2 : 5, 'batch');
    }

    case 'cell-subdivision': {
      const owner = classifyCellSubdivisionOwner(node.cell);
      return owner === undefined ? undefined : rank(owner.epoch, 9, 'batch');
    }

    case 'outflow-subdivision': {
      const owner = classifyCellOutflowSubdivisionOwner(node.cell);
      return owner === undefined ? undefined : rank(owner.epoch, 11, 'batch');
    }

    case 'inflow-subdivision': {
      const owner = classifyCellInflowSubdivisionOwner(node.cell);
      return owner === undefined ? undefined : rank(owner.epoch, 11, 'batch');
    }

    case 'flow-space-subdivision': {
      const owner = classifyFlowSpaceSubdivisionOwner(node.flow);
      return owner === undefined ? undefined : rank(owner.epoch, 13, 'batch');
    }
  }
}

export function compareBirdsDependencyRanks(
  left: BirdsDependencyRank,
  right: BirdsDependencyRank,
): number {
  return left.epoch - right.epoch || left.order - right.order;
}

function rank(
  epoch: number,
  order: number,
  role: BirdsDependencyRank['role'],
): BirdsDependencyRank {
  return { epoch, order, role };
}
