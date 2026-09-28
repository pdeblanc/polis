import type { Birds2aCell } from '../birds2a/classifiers';
import { classifyBirds2aCellGeometry } from '../birds2a/classifiers';
import { EXPANSION_DEFAULT_CELL_WIDTH, type ExpansionCell } from '../birds2a/expansion';
import type { Birds2aMotionSupport } from '../birds2a/motionSupport';

/** The canonical disjoint partition ..., [-2,-1), [-1,0), [0,1), [1,2), ... */
export function originChannelAt(x: number): ExpansionCell {
  if (!Number.isFinite(x)) throw new RangeError('Origin coordinate must be finite');
  const base = EXPANSION_DEFAULT_CELL_WIDTH;
  if (x >= -base && x < base) return x < 0 ? { min: -base, max: 0 } : { min: 0, max: base };
  let width = 2 ** (x >= base ? Math.floor(Math.log2(x)) : Math.ceil(Math.log2(-x)) - 1);
  // log2 can round a value just beside a power of two onto that power.
  if (x >= base && width > x) width /= 2;
  if (x < -base && -2 * width > x) width *= 2;
  const cell = x >= base ? { min: width, max: 2 * width } : { min: -2 * width, max: -width };
  if (!Number.isFinite(cell.min) || !Number.isFinite(cell.max) || !(cell.min <= x && x < cell.max)) {
    throw new RangeError('Origin channel exceeds numeric geometry');
  }
  return cell;
}

export function originChannelsIn(window: ExpansionCell): readonly ExpansionCell[] {
  if (!Number.isFinite(window.min) || !Number.isFinite(window.max) || window.min >= window.max) {
    throw new RangeError('Origin search requires a finite increasing interval');
  }
  const result: ExpansionCell[] = [];
  let cell = originChannelAt(window.min);
  while (cell.min < window.max) {
    result.push(cell);
    if (cell.max >= window.max) break;
    cell = originChannelAt(cell.max);
  }
  return result;
}

/** Invert local support toward t=0, without examining any individual channel.
 * Each positive population has a positive incident flow toward zero. Take up to
 * three quarter-duration steps, then spatially aggregate to double-width cells.
 * Time indices shrink by four, proving finite enumeration. Every contributing
 * origin must intersect the resulting interval, even if intervening candidates
 * have empty population supports. This is not a stop-at-first-miss heuristic.
 */
export function originSearchWindow(cell: Birds2aCell, support: Birds2aMotionSupport): ExpansionCell {
  const scale = classifyBirds2aCellGeometry(cell);
  if (!scale) throw new RangeError('Invalid Birds population cell');
  let steps = Math.abs(cell.time / scale.quarterDuration);
  if (!Number.isFinite(steps) || !Number.isInteger(steps)) throw new RangeError('Origin search exceeds numeric time precision');
  let width = scale.cellWidth;
  let { min, max } = cell;
  const radius = Math.floor(support.quarterRadius);
  while (steps > 0) {
    const displacement = (steps % 4) * radius * width;
    min -= displacement; max += displacement;
    steps = Math.floor(steps / 4);
    if (steps > 0) {
      width *= 2;
      min = Math.floor(min / width) * width;
      max = Math.ceil(max / width) * width;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new RangeError('Origin search exceeds numeric spatial precision');
  return { min, max };
}
