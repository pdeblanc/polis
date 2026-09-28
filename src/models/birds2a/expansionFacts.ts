import { Birds2aExpansion, type ContributionFrame, type ExpansionCell } from './expansion';
import type { Birds2aCell, ExpansionFrameProjection, ExpansionFlowProjection } from './classifiers';

/** Internal readers for classifier-provided projections. An omitted sparse entry is
 * zero, not a request to resample. These are not partial public model queries. */
export function readExpansionCell(
  expansion: Birds2aExpansion, cell: Birds2aCell, projection: ExpansionFrameProjection,
): number {
  return readFrame(expansion, projection).contributions.reduce(
    (sum, entry) => sum + (contains(cell, entry.cell) ? entry.count : 0), 0);
}

export function readExpansionFlow(expansion: Birds2aExpansion, projection: ExpansionFlowProjection): number {
  const origin = projection.kind === 'origin-endpoint';
  const epoch = expansion.getEpoch(origin ? projection.frame.epoch : projection.epoch);
  const inner = origin ? projection.originCell : projection.innerCell;
  const outer = origin ? projection.endpointCell : projection.outerCell;
  const step = epoch.ordinaryFlows.find(({ from, to }) =>
    from.time === inner.time && to.time === outer.time &&
    from.cellWidth === inner.max - inner.min && to.cellWidth === outer.max - outer.min);
  if (!step) throw new Error('Missing ordinary expansion flow geometry');
  return step.allocations.find(({ fromCell }) => fromCell.min === inner.min)
    ?.destinations.find(({ cell }) => cell.min === outer.min)?.count ?? 0;
}

function readFrame(expansion: Birds2aExpansion, projection: ExpansionFrameProjection): ContributionFrame {
  const epoch = expansion.getEpoch(projection.epoch);
  if (projection.kind === 'extension-frame') {
    if (epoch.kind !== 'expanded') throw new Error('Expected an expansion epoch for a frame projection');
    const extension = projection.branch === 'forward' ? epoch.forwardExtension : epoch.backwardExtension;
    return projection.slot === 4 ? extension.direct.to : extension.steps[projection.slot - 2].to;
  }
  if (epoch.kind !== 'initial') throw new Error('Expected initialization for a frame projection');
  return projection.kind === 'initial-origin' ? epoch.atZero : epoch[projection.branch];
}

function contains(outer: ExpansionCell, inner: ExpansionCell): boolean {
  return inner.min >= outer.min && inner.max <= outer.max;
}
