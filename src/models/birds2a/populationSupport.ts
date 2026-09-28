import type { ExpansionCell } from './expansion';
import { birds2aScale } from './classifiers';
import type { Birds2aMotionSupport } from './motionSupport';

/** Conservative support of population snapshots, including whole query cells.
 * Walk toward t=0 using up to three quarter-duration steps per scale, then
 * aggregate spatially and repeat. Conservation and the local flow window imply
 * that every occupied cell is inside this interval. No stochastic queries occur.
 * Undefined means the requested lattice/index cannot be represented safely.
 */
export function birds2aPopulationSupport(
  origin: ExpansionCell, support: Birds2aMotionSupport, time: number, cellWidth: number,
): ExpansionCell | undefined {
  const scale = birds2aScale(cellWidth);
  if (!scale) return undefined;
  let steps = Math.abs(time / scale.quarterDuration);
  if (!Number.isSafeInteger(steps)) return undefined;
  let width = cellWidth;
  let displacement = 0;
  const radius = Math.floor(support.quarterRadius);
  while (steps > 0) {
    displacement += (steps % 4) * radius * width;
    steps = Math.floor(steps / 4);
    if (steps > 0) width *= 2;
  }
  // At zero only cells intersecting the origin can contain this channel.
  // Reverse the coarsenings: spatial children stay within their parent;
  // each flow step enlarges the interval by its maximum displacement.
  const min = Math.floor(origin.min / width) * width - displacement;
  const max = Math.ceil(origin.max / width) * width + displacement;
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : undefined;
}
