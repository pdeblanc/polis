import type { BirdsQueryBackend } from '../birds/birdsQueryApi';
import { birds2aScale, classifyBirds2aCellGeometry } from './classifiers';
import type { ExpansionCell } from './expansion';
import { possibleBirds2aFlowDestinations, possibleBirds2aFlowSources, type Birds2aMotionSupport } from './motionSupport';

/** Shared Birds 2 query geometry. Origin affects ownership inside a channel,
 * but not which cell widths/durations are legal or the local offset radii. */
export function birds2QueryBackend(
  engine: BirdsQueryBackend['engine'], origin: ExpansionCell, support: Birds2aMotionSupport,
): BirdsQueryBackend {
  return {
    ...birds2QueryGeometry(engine),
    destinations: (cell, duration) => possibleBirds2aFlowDestinations(cell, duration, origin, support),
    sources: (cell, duration) => possibleBirds2aFlowSources(cell, duration, origin, support),
  };
}

/** Resolution geometry shared with the unbounded Brownian mean reference. */
export function birds2QueryGeometry(engine: BirdsQueryBackend['engine']): Omit<BirdsQueryBackend, 'destinations' | 'sources'> {
  return {
    engine,
    minimumEpoch: -Infinity,
    firstEpochAtWidth: (width) => Math.ceil(-Math.log2(width)),
    scale: (epoch) => {
      const scale = birds2aScale(2 ** -epoch);
      return scale && {
        epoch, cellLength: scale.cellWidth, childCellLength: scale.cellWidth / 2,
        flowDuration: scale.duration, halfFlowDuration: scale.halfDuration,
        nextFlowDuration: scale.quarterDuration,
      };
    },
    incidentDuration: (cell) => {
      const scale = classifyBirds2aCellGeometry(cell);
      if (!scale) throw new RangeError('Invalid Birds 2 cell');
      return [scale.duration, scale.halfDuration, scale.quarterDuration]
        .find((duration) => Number.isInteger(cell.time / duration))!;
    },
  };
}
