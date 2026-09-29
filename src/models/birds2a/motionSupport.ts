import { NORMAL_MAX_DEVIATIONS } from '../../utils/distributions/normal';
import { createMidpointKernels, midpointKernelForFlow, type MidpointKernels } from '../birds/midpointKernels';
import { EXPANSION_TIME_PER_WIDTH_SQUARED, type ExpansionCell } from './expansion';
import { classifyBirds2aCellGeometry, classifyBirds2aFlow, classifyBirds2FlowGeometry, type Birds2aCell, type Birds2aFlow } from './classifiers';
import { classifyBirds2aFlowTimeSubdivision } from './ownerClassifiers';

/** Conservative, seed-independent offset bounds, not exact nonzero-flow supports.
 * Equal-width offsets are measured in cell widths. Mixed-width flows use their
 * equal-width coarse parent and its quarter-duration bound. */
export interface Birds2aMotionSupport {
  readonly diffusionRate: number;
  readonly entryRadius: number;
  readonly halfRadius: number;
  readonly quarterRadius: number;
  readonly midpointKernels: MidpointKernels;
}

/** Expansion seeds plus a closed A–H refinement envelope. See the derivation in
 * BIRDS_EXPANSION_PROTOTYPE.md. No iteration, scale ceiling, or sampled calibration. */
export function createBirds2aMotionSupport(diffusionRate: number): Birds2aMotionSupport {
  if (!Number.isFinite(diffusionRate) || diffusionRate < 0) throw new RangeError('Diffusion rate must be finite and nonnegative');
  const variance = diffusionRate * EXPANSION_TIME_PER_WIDTH_SQUARED;
  const k = NORMAL_MAX_DEVIATIONS;
  const a = k * Math.sqrt(3 * variance) + 0.5;
  const b = k * Math.sqrt(2 * variance / 3) + 0.5;
  const c = k * Math.sqrt(variance / 2) + 0.5;
  const entrySeed = a + 1;
  const halfSeed = 2 * a / 3 + b / 2 + 1;
  const quarterSeed = Math.max(entrySeed / 2 + 0.5,
    (a / 3 + b) / 2 + 0.5, (a / 3 + b / 2 + c) / 2 + 0.5);
  // Refinement retains Birds 1's Brownian bridge variance D*duration/4.
  const firstNoise = k * Math.sqrt(variance / 4) + 0.5;
  const secondNoise = k * Math.sqrt(variance / 8) + 0.5;
  const entryRadius = Math.ceil(Math.max(entrySeed, 2 * quarterSeed + 1,
    halfSeed + 2 * secondNoise + 1, 2 * firstNoise + 4 * secondNoise + 2));
  if (!Number.isSafeInteger(entryRadius)) throw new RangeError('Motion support exceeds numeric offset precision');
  const halfRadius = Math.max(halfSeed, entryRadius / 2 + firstNoise);
  const quarterRadius = Math.max(quarterSeed, halfRadius / 2 + secondNoise);
  const midpointKernels = createMidpointKernels(variance);
  for (const pair of Object.values(midpointKernels)) {
    for (const table of [pair.midCell, pair.cellBoundary]) {
      table.forEach(Object.freeze); Object.freeze(table);
    }
    Object.freeze(pair);
  }
  return Object.freeze({ diffusionRate, entryRadius, halfRadius, quarterRadius,
    midpointKernels: Object.freeze(midpointKernels) });
}

export function isPossibleBirds2aFlow(flow: Birds2aFlow, _origin: ExpansionCell, support: Birds2aMotionSupport): boolean {
  return !!classifyBirds2FlowGeometry(flow) && isWithinBirds2MotionSupport(flow, support);
}

/** Radius-only check. Caller must already have established legal flow geometry. */
export function isWithinBirds2MotionSupport(flow: Birds2aFlow, support: Birds2aMotionSupport): boolean {
  const sw = flow.source.max - flow.source.min, dw = flow.destination.max - flow.destination.min;
  const width = Math.max(sw, dw);
  const offset = Math.floor(flow.destination.min / width) - Math.floor(flow.source.min / width);
  const duration = flow.destination.time - flow.source.time;
  const full = EXPANSION_TIME_PER_WIDTH_SQUARED * width ** 2;
  const radius = duration === full ? support.entryRadius : duration === full / 2 ? support.halfRadius : support.quarterRadius;
  return Math.abs(offset) <= radius;
}

/** All legal opposite widths, sorted spatially; callers may select their required width. */
export function possibleBirds2aFlowDestinations(
  source: Birds2aCell, duration: number, origin: ExpansionCell, support: Birds2aMotionSupport,
): readonly Birds2aCell[] {
  return incidentCells(source, duration, origin, support, true);
}

export function possibleBirds2aFlowSources(
  destination: Birds2aCell, duration: number, origin: ExpansionCell, support: Birds2aMotionSupport,
): readonly Birds2aCell[] {
  return incidentCells(destination, duration, origin, support, false);
}

function incidentCells(fixed: Birds2aCell, duration: number, origin: ExpansionCell,
  support: Birds2aMotionSupport, forwards: boolean): readonly Birds2aCell[] {
  const scale = classifyBirds2aCellGeometry(fixed);
  if (!scale || !(duration > 0) || !Number.isFinite(duration)) return [];
  const time = fixed.time + (forwards ? duration : -duration);
  const result: Birds2aCell[] = [];
  for (const width of [scale.cellWidth / 2, scale.cellWidth, scale.cellWidth * 2]) {
    const probe = indexedCell(0, width, time);
    const makeFlow = (opposite: Birds2aCell): Birds2aFlow => forwards
      ? { source: fixed, destination: opposite } : { source: opposite, destination: fixed };
    if (!classifyBirds2FlowGeometry(makeFlow(probe))) continue;
    const coarseWidth = Math.max(width, scale.cellWidth);
    const full = EXPANSION_TIME_PER_WIDTH_SQUARED * coarseWidth ** 2;
    const radius = Math.floor(duration === full ? support.entryRadius
      : duration === full / 2 ? support.halfRadius : support.quarterRadius);
    const center = Math.floor(fixed.min / coarseWidth), ratio = coarseWidth / width;
    const first = (center - radius) * ratio, last = (center + radius + 1) * ratio - 1;
    // Without this guard an index increment can stop making progress at numeric limits.
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) throw new RangeError('Motion window exceeds numeric index precision');
    for (let index = first; index <= last; index++) result.push(indexedCell(index, width, time));
  }
  return result.sort((a, b) => a.min - b.min || a.max - b.max);
}

/** Only contraction-owned A/C batches are valid here. Expansion-owned legs throw
 * in the owner classifier rather than inventing an unavailable joint allocation. */
export function birds2aMidpointCellProbabilities(
  flow: Birds2aFlow, origin: ExpansionCell, support: Birds2aMotionSupport,
): readonly { readonly cell: Birds2aCell; readonly probability: number }[] {
  const owner = classifyBirds2aFlowTimeSubdivision(flow, origin);
  if (!owner || !isWithinBirds2MotionSupport(flow, support)) return [];
  const width = owner.midpointCellWidth, sourceIndex = flow.source.min / width;
  const offset = flow.destination.min / width - sourceIndex;
  return midpointKernelForFlow(support.midpointKernels, offset, owner.normalizedDuration)
    .filter(({ probability }) => probability > 0)
    .map(({ value, probability }) => ({ cell: indexedCell(sourceIndex + value, width, owner.midpointTime), probability }));
}

/** Invert the midpoint support for a B/D leg. Ordinary expansion facts have no
 * parent search: their classifier routes them directly to retained output. */
export function possibleBirds2aParentFlows(
  flow: Birds2aFlow, origin: ExpansionCell, support: Birds2aMotionSupport,
): readonly Birds2aFlow[] {
  const construction = classifyBirds2aFlow(flow, origin);
  if (construction?.kind !== 'temporal-aggregation' || !isWithinBirds2MotionSupport(flow, support)) return [];
  const first = construction.leg === 'first';
  const width = flow.source.max - flow.source.min;
  const midpoint = first ? flow.destination : flow.source;
  const endpoints = first
    ? possibleBirds2aFlowDestinations(flow.source, construction.parentDuration, origin, support)
    : possibleBirds2aFlowSources(flow.destination, construction.parentDuration, origin, support);
  return endpoints.filter((cell) => cell.max - cell.min === width)
    .map((cell) => first ? { source: flow.source, destination: cell } : { source: cell, destination: flow.destination })
    .filter((parent) => birds2aMidpointCellProbabilities(parent, origin, support)
      .some(({ cell }) => cell.min === midpoint.min));
}

function indexedCell(index: number, width: number, time: number): Birds2aCell {
  return { min: index === 0 ? 0 : index * width, max: (index + 1) * width, time };
}
