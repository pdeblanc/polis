import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { createAddressedRandom, type AddressedRandom, type Seed } from '../../utils/rng/addressedRandom';
import type { Address } from '../../utils/rng/address';
import { uniformUnit } from '../../utils/distributions/uniform';
import { multinomial } from '../../utils/distributions/multinomial';
import { roundedNormal, type ProbabilityMassTable } from '../../utils/distributions/roundedNormal';
import { NORMAL_MAX_DEVIATIONS } from '../../utils/distributions/normal';

export const EXPANSION_DEFAULT_CELL_WIDTH = 1;
export const EXPANSION_TIME_PER_WIDTH_SQUARED = 1;

export interface ExpansionCell { readonly min: number; readonly max: number }
export interface PopulationContribution { readonly cell: ExpansionCell; readonly count: number }

/** Contributions from ONE fixed origin at t=0, never global cell populations. */
export interface ContributionFrame {
  readonly time: number;
  readonly cellWidth: number;
  /** Sparse and spatially ordered; omitted cells contribute zero for this channel. */
  readonly contributions: readonly PopulationContribution[];
}

export interface ContributionAllocation {
  readonly fromCell: ExpansionCell;
  readonly destinations: readonly PopulationContribution[];
}

/** Backward steps follow the outward computation, opposite to chronological flow. */
export interface ContributionStep {
  readonly from: ContributionFrame;
  readonly to: ContributionFrame;
  readonly allocations: readonly ContributionAllocation[];
}

/** Conditional allocation of one endpoint pair through an intermediate time. */
export interface BridgeBatch {
  readonly fromTime: number;
  readonly toTime: number;
  readonly time: number;
  readonly fromCell: ExpansionCell;
  readonly toCell: ExpansionCell;
  readonly count: number;
  /** Full kernel allocation, including zeros, in increasing spatial order. */
  readonly intermediates: readonly PopulationContribution[];
}

export interface ChannelExtension {
  /** Sampled directly over duration 3T, at the inherited width L. */
  readonly direct: ContributionStep;
  /** One three-time allocation per T → 4T flow, split through 2T. */
  readonly firstBridges: readonly BridgeBatch[];
  /** 2T → 4T flows summed across their former T sources. */
  readonly fromTwo: ContributionStep;
  /** One three-time allocation per aggregated 2T → 4T flow, split through 3T. */
  readonly secondBridges: readonly BridgeBatch[];
  /** Derived adjacent steps, ordered outwards: T → 2T → 3T → 4T. */
  readonly steps: readonly [ContributionStep, ContributionStep, ContributionStep];
  /** Aggregation of direct.to into width-2L cells, used by the next epoch. */
  readonly coarsened: ContributionFrame;
}

interface EpochState {
  readonly index: number;
  readonly origin: ExpansionCell;
  readonly population: number;
  readonly cellWidth: number;
  readonly timeStep: number;
  readonly forward: ContributionFrame;
  readonly backward: ContributionFrame;
  /** All ordinary flow geometries introduced by this epoch, including mixed widths.
   * Sparse, eagerly aggregated, and oriented outwards on both time branches. */
  readonly ordinaryFlows: readonly ContributionStep[];
}
export type ExpansionEpoch = EpochState & (
  | { readonly kind: 'initial'; readonly atZero: ContributionFrame;
      readonly forwardStep: ContributionStep; readonly backwardStep: ContributionStep }
  | { readonly kind: 'expanded'; readonly forwardExtension: ChannelExtension;
      readonly backwardExtension: ChannelExtension }
);

/** Single-origin outward expansion. All records are retained.
 * No contraction, global-channel summation, or spacetime completeness guarantee. */
export class Birds2aExpansion {
  readonly origin: ExpansionCell;
  readonly populationDensity: number;
  readonly diffusionRate: number;
  readonly kernels: Readonly<{
    initial: ProbabilityMassTable;
    initialBackward: ProbabilityMassTable;
    extension: ProbabilityMassTable;
    extensionBackward: ProbabilityMassTable;
    /** Means 0, 1/3, 2/3, respectively. */
    firstBridge: readonly ProbabilityMassTable[];
    /** Means 0, 1/2, respectively. */
    secondBridge: readonly ProbabilityMassTable[];
  }>;
  readonly #random: AddressedRandom;
  readonly #epochs: ExpansionEpoch[] = [];

  constructor(seed: Seed, populationDensity: number, diffusionRate: number,
    origin: ExpansionCell = { min: 0, max: EXPANSION_DEFAULT_CELL_WIDTH }) {
    for (const value of [populationDensity, diffusionRate]) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError('Parameters must be finite and nonnegative');
    }
    const width = origin.max - origin.min;
    if (!(width > 0) || !Number.isInteger(Math.log2(width)) || !Number.isSafeInteger(origin.min / width)) {
      throw new RangeError('Origin must be an aligned dyadic cell');
    }
    this.origin = cell(origin.min, width);
    this.populationDensity = populationDensity;
    this.diffusionRate = diffusionRate;
    this.#random = createAddressedRandom(seed);
    const variance = diffusionRate * EXPANSION_TIME_PER_WIDTH_SQUARED;
    // Source/endpoints are represented by cell centers. This is a discretized
    // Brownian-inspired construction, not exact conditioning of a rounded process.
    const table = (mean: number, variance: number) => {
      const sigma = Math.sqrt(variance);
      if (!Number.isSafeInteger(Math.ceil(mean + NORMAL_MAX_DEVIATIONS * sigma))) {
        throw new RangeError('Kernel exceeds numeric offset precision');
      }
      return Object.freeze(roundedNormal(mean, sigma).map((entry) => Object.freeze(entry)));
    };
    const initial = table(0, variance), extension = table(0, 3 * variance);
    this.kernels = Object.freeze({ initial, initialBackward: reflect(initial),
      extension, extensionBackward: reflect(extension),
      firstBridge: Object.freeze([0, 1 / 3, 2 / 3].map((mean) => table(mean, 2 * variance / 3))),
      secondBridge: Object.freeze([0, 0.5].map((mean) => table(mean, variance / 2))),
    });
  }

  get retainedEpochCount(): number { return this.#epochs.length; }

  /** Eagerly builds each missing epoch once, retaining an unbounded immutable prefix. */
  getEpoch(index: number): ExpansionEpoch {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Epoch must be a nonnegative safe integer');
    while (this.#epochs.length <= index) {
      const previous = this.#epochs.at(-1);
      this.#epochs.push(previous ? this.#expand(previous) : this.#initialize());
    }
    return this.#epochs[index];
  }

  #initialize(): ExpansionEpoch {
    const width = this.origin.max - this.origin.min;
    const duration = width ** 2 * EXPANSION_TIME_PER_WIDTH_SQUARED;
    if (!(duration > 0) || !Number.isFinite(duration)) throw new RangeError('Expansion exceeds numeric geometry');
    const mean = this.populationDensity * width;
    if (!Number.isFinite(mean)) throw new RangeError('Poisson mean exceeds numeric range');
    // No population-tail clamp or large-mean normal approximation. Finite RNG
    // precision and safe-integer storage still apply; failures are not clipped.
    const population = safeCount(mean === 0 ? 0 : poissonQuantile(
      uniformUnit(this.#random, ['birds-expansion.population', this.origin.min, this.origin.max]), mean));
    const atZero = frame(0, width, population ? [contribution(this.origin, population)] : []);
    const forwardStep = this.#advance(atZero, duration, this.kernels.initial);
    const backwardStep = this.#advance(atZero, -duration, this.kernels.initialBackward);
    return Object.freeze({ kind: 'initial', index: 0, origin: this.origin, population,
      cellWidth: width, timeStep: duration, atZero, forwardStep, backwardStep,
      ordinaryFlows: Object.freeze([forwardStep, backwardStep].flatMap(ordinaryQuarterFlows)),
      forward: forwardStep.to, backward: backwardStep.to });
  }

  #expand(previous: ExpansionEpoch): ExpansionEpoch {
    const width = 2 * previous.cellWidth, duration = 4 * previous.timeStep;
    if (!Number.isFinite(width) || !Number.isFinite(duration)) throw new RangeError('Expansion exceeds numeric geometry');
    const forwardExtension = this.#extend(previous.forward, this.kernels.extension);
    const backwardExtension = this.#extend(previous.backward, this.kernels.extensionBackward);
    return Object.freeze({ kind: 'expanded', index: previous.index + 1,
      origin: this.origin, population: previous.population, cellWidth: width, timeStep: duration,
      forwardExtension, backwardExtension,
      ordinaryFlows: Object.freeze([forwardExtension, backwardExtension].flatMap((extension) => [
        // Single-origin membership determines 0 → 2T and 0 → 4T without
        // reconstructing a joint trajectory across the intervening steps.
        aggregateStep(originStep(this.origin, previous.population, extension.steps[0].to), width, width),
        ...ordinaryQuarterFlows(aggregateStep(
          originStep(this.origin, previous.population, extension.direct.to), width, width)),
        aggregateStep(extension.fromTwo, width, width),
        ...extension.steps.flatMap(ordinaryQuarterFlows),
      ])),
      forward: forwardExtension.coarsened, backward: backwardExtension.coarsened });
  }

  #extend(initial: ContributionFrame, kernel: ProbabilityMassTable): ChannelExtension {
    const t = initial.time, width = initial.cellWidth;
    // Generate all 4T endpoints, then all 2T allocations, then all 3T allocations.
    const direct = this.#advance(initial, 4 * t, kernel);
    const firstBridges = Object.freeze(direct.allocations.flatMap(({ fromCell, destinations }) =>
      destinations.filter(({ count }) => count > 0).map(({ cell: toCell, count }) =>
        this.#bridge(t, 4 * t, 2 * t, fromCell, toCell, count, width, 1, 3))));
    const firstLeg = new Map<number, Map<number, number>>();
    const lastLeg = new Map<number, Map<number, number>>();
    for (const batch of firstBridges) for (const { cell, count } of batch.intermediates) {
      if (!count) continue;
      addEdge(firstLeg, batch.fromCell.min, cell.min, count);
      addEdge(lastLeg, cell.min, batch.toCell.min, count);
    }
    const first = stepFromEdges(initial, 2 * t, firstLeg);
    const fromTwo = Object.freeze({ ...stepFromEdges(first.to, 4 * t, lastLeg), to: direct.to });
    // As in Birds 1, aggregate legs before subdividing again. The second batch
    // owns only its 2T and 4T endpoints, not its former T source.
    const secondBridges = Object.freeze(fromTwo.allocations.flatMap(({ fromCell, destinations }) =>
      destinations.map(({ cell: toCell, count }) =>
        this.#bridge(2 * t, 4 * t, 3 * t, fromCell, toCell, count, width, 1, 2))));
    const firstHalf = new Map<number, Map<number, number>>();
    const secondHalf = new Map<number, Map<number, number>>();
    for (const batch of secondBridges) for (const { cell, count } of batch.intermediates) {
      if (!count) continue;
      addEdge(firstHalf, batch.fromCell.min, cell.min, count);
      addEdge(secondHalf, cell.min, batch.toCell.min, count);
    }
    const second = stepFromEdges(fromTwo.from, 3 * t, firstHalf);
    const third = Object.freeze({ ...stepFromEdges(second.to, 4 * t, secondHalf), to: fromTwo.to });
    return Object.freeze({ direct, firstBridges, fromTwo, secondBridges,
      steps: Object.freeze([first, second, third] as const), coarsened: coarsen(direct.to) });
  }

  #advance(from: ContributionFrame, time: number, kernel: ProbabilityMassTable): ContributionStep {
    const totals = new Map<number, number>();
    const allocations = from.contributions.map(({ cell: fromCell, count }) => {
      const destinations = this.#allocate(
        ['transport', from.time, time, fromCell.min, fromCell.max], count, kernel, fromCell.min, from.cellWidth);
      for (const { cell, count } of destinations) if (count) add(totals, cell.min, count);
      return Object.freeze({ fromCell, destinations });
    });
    return Object.freeze({ from, to: frameFromTotals(time, from.cellWidth, totals), allocations: Object.freeze(allocations) });
  }

  #bridge(fromTime: number, toTime: number, time: number, fromCell: ExpansionCell, toCell: ExpansionCell,
    count: number, width: number, numerator: number, denominator: 2 | 3): BridgeBatch {
    // Center interpolation becomes integer-index interpolation on an equal-width grid.
    // Floor and a nonnegative remainder also handle negative endpoint displacements.
    const offsetNumerator = numerator * ((toCell.min - fromCell.min) / width);
    const base = Math.floor(offsetNumerator / denominator);
    const phase = offsetNumerator - base * denominator;
    const kernel = (denominator === 3 ? this.kernels.firstBridge : this.kernels.secondBridge)[phase];
    const intermediates = this.#allocate(
      ['bridge', fromTime, toTime, time, fromCell.min, fromCell.max, toCell.min, toCell.max],
      count, kernel, fromCell.min + base * width, width);
    return Object.freeze({ fromTime, toTime, time, fromCell, toCell, count, intermediates });
  }

  #allocate(address: Address, count: number, kernel: ProbabilityMassTable, base: number, width: number): readonly PopulationContribution[] {
    const cells = kernel.map(({ value }) => cell(base + value * width, width));
    const counts = multinomial(this.#random,
      ['birds-expansion', this.origin.min, this.origin.max, ...address], count,
      kernel.map(({ probability }, i) => ({ probability, address: [cells[i].min, cells[i].max] })));
    return Object.freeze(cells.map((cell, i) => contribution(cell, counts[i])));
  }
}

/** For duration w², ordinary queries allow (w,w), (2w,2w), and both
 * mixed-width margins. This includes the coarse view needed by the next epoch.
 * Half-duration flows have only one legal equal-width geometry. */
function ordinaryQuarterFlows(step: ContributionStep): ContributionStep[] {
  const width = step.from.cellWidth;
  return [[width, width], [2 * width, 2 * width], [width, 2 * width], [2 * width, width]]
    .map(([fromWidth, toWidth]) => aggregateStep(step, fromWidth, toWidth));
}

function originStep(origin: ExpansionCell, population: number, to: ContributionFrame): ContributionStep {
  return Object.freeze({
    from: frame(0, origin.max - origin.min, population ? [contribution(origin, population)] : []),
    to,
    allocations: Object.freeze(population ? [Object.freeze({ fromCell: origin, destinations: to.contributions })] : []),
  });
}

/** Aggregate either endpoint independently; never draw new randomness. */
function aggregateStep(step: ContributionStep, fromWidth: number, toWidth: number): ContributionStep {
  const edges = new Map<number, Map<number, number>>();
  const fromTotals = new Map<number, number>(), toTotals = new Map<number, number>();
  for (const { fromCell, destinations } of step.allocations) for (const { cell, count } of destinations) {
    if (!count) continue;
    const from = Math.floor(fromCell.min / fromWidth) * fromWidth;
    const to = Math.floor(cell.min / toWidth) * toWidth;
    addEdge(edges, from, to, count);
    add(fromTotals, from, count);
    add(toTotals, to, count);
  }
  const from = frameFromTotals(step.from.time, fromWidth, fromTotals);
  return Object.freeze({ from, to: frameFromTotals(step.to.time, toWidth, toTotals),
    allocations: Object.freeze(from.contributions.map(({ cell: fromCell }) => Object.freeze({
      fromCell, destinations: frameFromTotals(step.to.time, toWidth, edges.get(fromCell.min)!).contributions,
    }))),
  });
}

function coarsen(input: ContributionFrame): ContributionFrame {
  const width = 2 * input.cellWidth, totals = new Map<number, number>();
  for (const { cell, count } of input.contributions) add(totals, Math.floor(cell.min / width) * width, count);
  return frameFromTotals(input.time, width, totals);
}
function addEdge(edges: Map<number, Map<number, number>>, from: number, to: number, count: number) {
  let destinations = edges.get(from);
  if (!destinations) { destinations = new Map(); edges.set(from, destinations); }
  add(destinations, to, count);
}
function stepFromEdges(from: ContributionFrame, time: number, edges: Map<number, Map<number, number>>): ContributionStep {
  const totals = new Map<number, number>();
  const allocations = from.contributions.map(({ cell: fromCell }) => {
    const destinations = frameFromTotals(time, from.cellWidth, edges.get(fromCell.min)!).contributions;
    for (const { cell, count } of destinations) add(totals, cell.min, count);
    return Object.freeze({ fromCell, destinations });
  });
  return Object.freeze({ from, to: frameFromTotals(time, from.cellWidth, totals), allocations: Object.freeze(allocations) });
}
function reflect(table: ProbabilityMassTable): ProbabilityMassTable {
  // Reflect clamp atoms too, including Math.round's possible endpoint asymmetry.
  return Object.freeze(table.map(({ value, probability }) => Object.freeze({ value: value === 0 ? 0 : -value, probability })).reverse());
}
function add(totals: Map<number, number>, min: number, count: number) { totals.set(min, safeCount((totals.get(min) ?? 0) + count)); }
function cell(min: number, width: number): ExpansionCell {
  const max = min + width;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min !== width) throw new RangeError('Cell exceeds numeric geometry');
  return Object.freeze({ min: min === 0 ? 0 : min, max: max === 0 ? 0 : max });
}
function contribution(cell: ExpansionCell, count: number): PopulationContribution {
  // Some inverse-CDF results are -0; counts have only one representation of zero.
  return Object.freeze({ cell, count: count === 0 ? 0 : count });
}
function frame(time: number, cellWidth: number, contributions: PopulationContribution[]): ContributionFrame {
  return Object.freeze({ time, cellWidth, contributions: Object.freeze(contributions) });
}
function frameFromTotals(time: number, width: number, totals: Map<number, number>): ContributionFrame {
  return frame(time, width, [...totals].sort(([a], [b]) => a - b).map(([min, count]) => contribution(cell(min, width), count)));
}
function safeCount(count: number): number {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Population exceeds safe-integer counts');
  return count === 0 ? 0 : count;
}
