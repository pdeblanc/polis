import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { createAddressedRandom, type AddressedRandom, type Seed } from '../utils/rng/addressedRandom';
import type { Address } from '../utils/rng/address';
import { uniformUnit } from '../utils/distributions/uniform';
import { multinomial } from '../utils/distributions/multinomial';
import { roundedNormal, type ProbabilityMassTable } from '../utils/distributions/roundedNormal';
import { NORMAL_MAX_DEVIATIONS } from '../utils/distributions/normal';

export const EXPANSION_DEFAULT_CELL_WIDTH = 16;
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

export interface TrisectedFlow {
  /** T → 4T, split at 3T. */
  readonly late: BridgeBatch;
  /** T → 3T, split at 2T; one batch per positive late allocation.
   * Nested beneath `late` to retain the original 4T destination as well. */
  readonly early: readonly BridgeBatch[];
}

export interface ChannelExtension {
  /** Sampled directly over duration 3T, at the inherited width L. */
  readonly direct: ContributionStep;
  /** Retained joint counts for (T, 2T, 3T, 4T), not just adjacent marginals. */
  readonly bridges: readonly TrisectedFlow[];
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
}
export type ExpansionEpoch = EpochState & (
  | { readonly kind: 'initial'; readonly atZero: ContributionFrame;
      readonly forwardStep: ContributionStep; readonly backwardStep: ContributionStep }
  | { readonly kind: 'expanded'; readonly forwardExtension: ChannelExtension;
      readonly backwardExtension: ChannelExtension }
);

/** Standalone single-origin, outward-only experiment. All records are retained.
 * No contraction, global-channel summation, or spacetime completeness guarantee. */
export class BirdsExpansion {
  readonly origin: ExpansionCell;
  readonly populationDensity: number;
  readonly diffusionRate: number;
  readonly kernels: Readonly<{
    initial: ProbabilityMassTable;
    initialBackward: ProbabilityMassTable;
    extension: ProbabilityMassTable;
    extensionBackward: ProbabilityMassTable;
    /** Means 0, 1/3, 2/3, respectively. */
    lateBridge: readonly ProbabilityMassTable[];
    /** Means 0, 1/2, respectively. */
    earlyBridge: readonly ProbabilityMassTable[];
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
      lateBridge: Object.freeze([0, 1 / 3, 2 / 3].map((mean) => table(mean, 2 * variance / 3))),
      earlyBridge: Object.freeze([0, 0.5].map((mean) => table(mean, variance / 2))),
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
      forward: forwardExtension.coarsened, backward: backwardExtension.coarsened });
  }

  #extend(initial: ContributionFrame, kernel: ProbabilityMassTable): ChannelExtension {
    const t = initial.time, width = initial.cellWidth;
    // Generate all 4T endpoints, then all 3T allocations, then all 2T allocations.
    const direct = this.#advance(initial, 4 * t, kernel);
    const lateBatches = direct.allocations.flatMap(({ fromCell, destinations }) =>
      destinations.filter(({ count }) => count > 0).map(({ cell: toCell, count }) =>
        this.#bridge(t, 4 * t, 3 * t, fromCell, toCell, count, width, 2, 3, [])));
    const bridges = Object.freeze(lateBatches.map((late) => Object.freeze({ late,
      early: Object.freeze(late.intermediates.filter(({ count }) => count > 0).map(({ cell: toCell, count }) =>
        this.#bridge(t, 3 * t, 2 * t, late.fromCell, toCell, count, width, 1, 2,
          [late.toCell.min, late.toCell.max]))),
    })));
    // Sum the retained joint table; no further sampling for adjacent-time flows.
    const edges = [new Map<number, Map<number, number>>(), new Map<number, Map<number, number>>(), new Map<number, Map<number, number>>()];
    for (const { late, early } of bridges) for (const batch of early) {
      for (const { cell: middle, count } of batch.intermediates) {
        if (!count) continue;
        addEdge(edges[0], late.fromCell.min, middle.min, count);
        addEdge(edges[1], middle.min, batch.toCell.min, count);
        addEdge(edges[2], batch.toCell.min, late.toCell.min, count);
      }
    }
    const first = stepFromEdges(initial, 2 * t, edges[0]);
    const second = stepFromEdges(first.to, 3 * t, edges[1]);
    const third = Object.freeze({ ...stepFromEdges(second.to, 4 * t, edges[2]), to: direct.to });
    return Object.freeze({ direct, bridges, steps: Object.freeze([first, second, third] as const),
      coarsened: coarsen(direct.to) });
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
    count: number, width: number, numerator: number, denominator: 2 | 3, context: Address): BridgeBatch {
    // Center interpolation becomes integer-index interpolation on an equal-width grid.
    // Floor and a nonnegative remainder also handle negative endpoint displacements.
    const offsetNumerator = numerator * ((toCell.min - fromCell.min) / width);
    const base = Math.floor(offsetNumerator / denominator);
    const phase = offsetNumerator - base * denominator;
    const kernel = (denominator === 3 ? this.kernels.lateBridge : this.kernels.earlyBridge)[phase];
    const intermediates = this.#allocate(
      ['bridge', fromTime, toTime, time, fromCell.min, fromCell.max, toCell.min, toCell.max, ...context],
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
function contribution(cell: ExpansionCell, count: number): PopulationContribution { return Object.freeze({ cell, count }); }
function frame(time: number, cellWidth: number, contributions: PopulationContribution[]): ContributionFrame {
  return Object.freeze({ time, cellWidth, contributions: Object.freeze(contributions) });
}
function frameFromTotals(time: number, width: number, totals: Map<number, number>): ContributionFrame {
  return frame(time, width, [...totals].sort(([a], [b]) => a - b).map(([min, count]) => contribution(cell(min, width), count)));
}
function safeCount(count: number): number {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Population exceeds safe-integer counts');
  return count;
}
