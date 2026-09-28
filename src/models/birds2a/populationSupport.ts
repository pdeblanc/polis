import type { ProbabilityMassTable } from '../../utils/distributions/roundedNormal';
import type { MidpointKernels } from '../birds/midpointKernels';
import { EXPANSION_TIME_PER_WIDTH_SQUARED, type Birds2aExpansion, type ExpansionCell } from './expansion';

/** Seed-independent support at a time, with no display-resolution assumption.
 * Propagate kernel supports through expansion, then follow the A/C midpoint
 * construction down to the requested time. Spatial subdivision stays inside
 * parent cells. Endpoint correlations are discarded, so this is conservative.
 * No population queries or expansion batches are evaluated.
 */
export function birds2aPopulationSupport(
  origin: ExpansionCell, kernels: Birds2aExpansion['kernels'], midpointKernels: MidpointKernels,
  time: number,
): ExpansionCell | undefined {
  if (!Number.isFinite(time)) return undefined;
  if (time === 0) return { ...origin };
  const target = Math.abs(time);
  let width = origin.max - origin.min;
  let duration = EXPANSION_TIME_PER_WIDTH_SQUARED * width ** 2;
  if (!(duration > 0) || !Number.isFinite(duration)) return undefined;
  const initial = time > 0 ? kernels.initial : kernels.initialBackward;
  const extension = time > 0 ? kernels.extension : kernels.extensionBackward;
  let endpoint = transport(origin, width, initial);
  if (target <= duration) return refine(origin, endpoint, 0, duration, width, target, midpointKernels);

  for (;;) {
    const endTime = 4 * duration;
    if (!Number.isFinite(endTime)) return undefined;
    const end = transport(endpoint, width, extension);
    if (target <= endTime) {
      if (target === endTime) return end;
      const two = bridge(endpoint, end, width, 3, kernels.firstBridge);
      if (!two) return undefined;
      if (target <= 2 * duration) return refine(endpoint, two, duration, 2 * duration, width, target, midpointKernels);
      const three = bridge(two, end, width, 2, kernels.secondBridge);
      if (!three) return undefined;
      if (target <= 3 * duration) return refine(two, three, 2 * duration, 3 * duration, width, target, midpointKernels);
      return refine(three, end, 3 * duration, endTime, width, target, midpointKernels);
    }
    width *= 2;
    duration = endTime;
    endpoint = { min: Math.floor(end.min / width) * width, max: Math.ceil(end.max / width) * width };
  }
}

function transport(from: ExpansionCell, width: number, kernel: ProbabilityMassTable): ExpansionCell {
  const offsets = extremes(kernel);
  return { min: from.min + offsets.min * width, max: from.max + offsets.max * width };
}

/** Endpoint cell-index average with weight 1/denominator on the destination.
 * Check each phase explicitly: Math.round and reflected kernels need not have
 * symmetric endpoints. Including unattainable endpoint pairs only widens bounds.
 */
function bridge(
  from: ExpansionCell, to: ExpansionCell, width: number, denominator: 2 | 3,
  kernels: readonly ProbabilityMassTable[],
): ExpansionCell | undefined {
  const low = (denominator - 1) * (from.min / width) + to.min / width;
  const high = (denominator - 1) * (from.max / width - 1) + to.max / width - 1;
  if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high)) return undefined;
  let min = Infinity, max = -Infinity;
  for (let phase = 0; phase < denominator; phase++) {
    const first = Math.ceil((low - phase) / denominator);
    const last = Math.floor((high - phase) / denominator);
    if (first > last) continue;
    const offsets = extremes(kernels[phase]);
    min = Math.min(min, first + offsets.min);
    max = Math.max(max, last + offsets.max);
  }
  const result = { min: min * width, max: (max + 1) * width };
  return Number.isFinite(result.min) && Number.isFinite(result.max) && result.max > result.min ? result : undefined;
}

function refine(
  from: ExpansionCell, to: ExpansionCell, start: number, end: number, width: number,
  target: number, kernels: MidpointKernels,
): ExpansionCell | undefined {
  let normalizedDuration: 1 | 0.5 = 1;
  for (;;) {
    if (target === start) return from;
    if (target === end) return to;
    const middle = start + (end - start) / 2;
    if (middle === start || middle === end) return undefined;
    const pair = kernels[normalizedDuration];
    const bound = bridge(from, to, width, 2, [pair.midCell, pair.cellBoundary]);
    if (!bound) return undefined;
    if (target === middle) return bound;
    if (target < middle) { end = middle; to = bound; }
    else { start = middle; from = bound; }
    // A and C bisect time at the same width; F/H then halve spatial width.
    if (normalizedDuration === 1) normalizedDuration = 0.5;
    else { normalizedDuration = 1; width /= 2; }
  }
}

function extremes(table: ProbabilityMassTable): ExpansionCell {
  let min = Infinity, max = -Infinity;
  for (const { value, probability } of table) if (probability > 0) {
    min = Math.min(min, value); max = Math.max(max, value);
  }
  return { min, max };
}
