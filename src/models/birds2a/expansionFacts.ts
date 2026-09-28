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
  if (projection.kind === 'origin-endpoint') {
    if (!contains(projection.originCell, expansion.origin)) return 0;
    return readExpansionCell(expansion, projection.endpointCell, projection.frame);
  }
  const epoch = expansion.getEpoch(projection.epoch);
  if (epoch.kind !== 'expanded') throw new Error('Expected an expansion epoch for a step projection');
  const extension = projection.branch === 'forward' ? epoch.forwardExtension : epoch.backwardExtension;
  const step = projection.kind === 'extension-half' ? extension.fromTwo : extension.steps[projection.stepIndex];
  let total = 0;
  for (const batch of step.allocations) {
    if (!contains(projection.innerCell, batch.fromCell)) continue;
    for (const { cell, count } of batch.destinations) {
      if (contains(projection.outerCell, cell)) total += count;
    }
  }
  return total;
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
