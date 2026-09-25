import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { createAddressedRandom, type AddressedRandom, type Seed } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';
import { multinomial } from '../utils/distributions/multinomial';
import { roundedNormal, type ProbabilityMassTable } from '../utils/distributions/roundedNormal';
import { NORMAL_MAX_DEVIATIONS } from '../utils/distributions/normal';

export const EXPANSION_INITIAL_CELL_WIDTH = 16;
export const EXPANSION_INITIAL_TIME_STEP = 256;

export interface ExpansionCell { readonly min: number; readonly max: number }
export interface PopulationContribution { readonly cell: ExpansionCell; readonly count: number }

/** Contributions from ONE root at t=0, never total populations at the reached cells. */
export interface ContributionFrame {
  readonly time: number;
  readonly cellWidth: number;
  /** Sparse and spatially ordered; omitted cells contribute zero for this cohort. */
  readonly contributions: readonly PopulationContribution[];
}

export interface ContributionAllocation {
  readonly fromCell: ExpansionCell;
  /** Full kernel allocation, including zero counts, in increasing destination order. */
  readonly destinations: readonly PopulationContribution[];
}

/** In the backward branch, propagation runs opposite to chronological flow direction. */
export interface ContributionStep {
  readonly origin: ExpansionCell;
  readonly from: ContributionFrame;
  readonly to: ContributionFrame;
  readonly allocations: readonly ContributionAllocation[];
}

export interface ExpansionRoot {
  readonly cell: ExpansionCell;
  readonly population: number;
  /** Outgoing/incoming endpoint counts, still labeled by this t=0 root. */
  readonly forward: ContributionFrame;
  readonly backward: ContributionFrame;
}

export interface RootInitialization {
  readonly root: ExpansionRoot;
  readonly atZero: ContributionFrame;
  readonly forwardStep: ContributionStep;
  readonly backwardStep: ContributionStep;
}

export interface ExtendedCohort {
  /** Its existing ±T frames are the inputs to the first extension steps. */
  readonly root: ExpansionRoot;
  /** Three steps: ±T → ±2T → ±3T → ±4T. */
  readonly forwardSteps: readonly ContributionStep[];
  readonly backwardSteps: readonly ContributionStep[];
}

export interface RootAggregation {
  readonly children: readonly [ExtendedCohort, ExtendedCohort];
  readonly root: ExpansionRoot;
}

export interface ExpansionEpoch {
  readonly index: number;
  readonly cellWidth: number;
  readonly timeStep: number;
  readonly roots: readonly [ExpansionRoot, ExpansionRoot];
  /** Initial two roots at epoch 0; the two new outer siblings thereafter. */
  readonly introduced: readonly [RootInitialization, RootInitialization];
  /** Empty at epoch 0; four t=0 cohorts thereafter, in spatial order. */
  readonly extensions: readonly ExtendedCohort[];
  readonly aggregations: readonly RootAggregation[];
}

/** Standalone outward-only experiment. All returned records are immutable and retained.
 * No refinement, completeness guarantee, production Birds dependency, or cache eviction.
 */
export class BirdsExpansion {
  readonly populationDensity: number;
  readonly diffusionRate: number;
  readonly kernels: Readonly<{ forward: ProbabilityMassTable; backward: ProbabilityMassTable }>;
  readonly #random: AddressedRandom;
  readonly #epochs: ExpansionEpoch[] = [];

  constructor(seed: Seed, populationDensity: number, diffusionRate: number) {
    for (const value of [populationDensity, diffusionRate]) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError('Parameters must be finite and nonnegative');
    }
    this.populationDensity = populationDensity;
    this.diffusionRate = diffusionRate;
    this.#random = createAddressedRandom(seed);
    // Forward variance is D*T, not the D*T/4 of a bridge with total duration T.
    // Source-center approximation; uniform-source integration is deliberately deferred.
    const sigma = Math.sqrt(diffusionRate * (EXPANSION_INITIAL_TIME_STEP / EXPANSION_INITIAL_CELL_WIDTH ** 2));
    if (!Number.isSafeInteger(Math.ceil(NORMAL_MAX_DEVIATIONS * sigma))) throw new RangeError('Kernel exceeds numeric offset precision');
    const forward = Object.freeze(roundedNormal(0, sigma).map((entry) => Object.freeze(entry)));
    // Explicit reflection also reflects any asymmetric Math.round clamp atoms.
    const backward = Object.freeze(forward.map(({ value, probability }) =>
      Object.freeze({ value: value === 0 ? 0 : -value, probability })).reverse());
    this.kernels = Object.freeze({ forward, backward });
  }

  get retainedEpochCount(): number { return this.#epochs.length; }

  /** Builds any missing prefix once; retained epochs never depend on request order. */
  getEpoch(index: number): ExpansionEpoch {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('Epoch must be a nonnegative safe integer');
    while (this.#epochs.length <= index) {
      const previous = this.#epochs.at(-1);
      this.#epochs.push(previous ? this.#expand(previous) : this.#initialize());
    }
    return this.#epochs[index];
  }

  #initialize(): ExpansionEpoch {
    const width = EXPANSION_INITIAL_CELL_WIDTH, duration = EXPANSION_INITIAL_TIME_STEP;
    const left = this.#introduce(cell(-width, width), duration);
    const right = this.#introduce(cell(0, width), duration);
    return Object.freeze({ index: 0, cellWidth: width, timeStep: duration,
      roots: pair(left.root, right.root), introduced: pair(left, right),
      extensions: Object.freeze([]), aggregations: Object.freeze([]) });
  }

  #expand(previous: ExpansionEpoch): ExpansionEpoch {
    const width = previous.cellWidth, duration = previous.timeStep;
    if (!Number.isFinite(2 * width) || !Number.isFinite(4 * duration)) throw new RangeError('Expansion exceeds numeric geometry');
    const left = this.#introduce(cell(-2 * width, width), duration);
    const right = this.#introduce(cell(width, width), duration);
    const extensions = Object.freeze([left.root, ...previous.roots, right.root]
      .map((root) => this.#extend(root, duration)));
    const aggregations = Object.freeze([
      aggregate(pair(extensions[0], extensions[1]), 2 * width),
      aggregate(pair(extensions[2], extensions[3]), 2 * width),
    ]);
    return Object.freeze({ index: previous.index + 1, cellWidth: 2 * width, timeStep: 4 * duration,
      roots: pair(aggregations[0].root, aggregations[1].root),
      introduced: pair(left, right), extensions, aggregations });
  }

  #introduce(origin: ExpansionCell, duration: number): RootInitialization {
    const width = origin.max - origin.min;
    const mean = this.populationDensity * width;
    if (!Number.isFinite(mean)) throw new RangeError('Poisson mean exceeds numeric range');
    // No model-tail clamp or large-mean normal approximation. Finite RNG precision
    // and safe-integer storage still apply; failures are explicit, not clipped counts.
    const population = safeCount(mean === 0 ? 0 : poissonQuantile(
      uniformUnit(this.#random, ['birds-expansion.population', origin.min, origin.max]), mean));
    const atZero = frame(0, width, population ? [contribution(origin, population)] : []);
    const forwardStep = this.#advance(origin, atZero, duration);
    const backwardStep = this.#advance(origin, atZero, -duration);
    const root = Object.freeze({ cell: origin, population, forward: forwardStep.to, backward: backwardStep.to });
    return Object.freeze({ root, atZero, forwardStep, backwardStep });
  }

  #extend(root: ExpansionRoot, duration: number): ExtendedCohort {
    const extend = (initial: ContributionFrame, direction: 1 | -1) => {
      const steps: ContributionStep[] = [];
      let current = initial;
      for (let multiplier = 2; multiplier <= 4; multiplier++) {
        const step = this.#advance(root.cell, current, direction * multiplier * duration);
        steps.push(step); current = step.to;
      }
      return Object.freeze(steps);
    };
    return Object.freeze({ root, forwardSteps: extend(root.forward, 1), backwardSteps: extend(root.backward, -1) });
  }

  #advance(origin: ExpansionCell, from: ContributionFrame, time: number): ContributionStep {
    const kernel = time > from.time ? this.kernels.forward : this.kernels.backward;
    const width = from.cellWidth;
    const totals = new Map<number, number>();
    const allocations = from.contributions.map(({ cell: fromCell, count }) => {
      const destinations = kernel.map(({ value }) => cell(fromCell.min + value * width, width));
      const counts = multinomial(this.#random,
        ['birds-expansion.transport', origin.min, origin.max, from.time, time, fromCell.min, fromCell.max],
        count, kernel.map(({ probability }, i) => ({ probability, address: [destinations[i].min, destinations[i].max] })));
      const assigned = counts.map((count, i) => {
        const destination = destinations[i];
        if (count) totals.set(destination.min, (totals.get(destination.min) ?? 0) + count);
        return contribution(destination, count);
      });
      return Object.freeze({ fromCell, destinations: Object.freeze(assigned) });
    });
    return Object.freeze({ origin, from, to: frameFromTotals(time, width, totals), allocations: Object.freeze(allocations) });
  }
}

function aggregate(children: readonly [ExtendedCohort, ExtendedCohort], width: number): RootAggregation {
  const merge = (direction: 'forwardSteps' | 'backwardSteps') => {
    const inputs = children.map((child) => child[direction].at(-1)!.to);
    const totals = new Map<number, number>();
    for (const input of inputs) for (const { cell, count } of input.contributions) {
      // Floor, not truncation: the negative side uses the same aligned grid.
      const min = Math.floor(cell.min / width) * width;
      totals.set(min, safeCount((totals.get(min) ?? 0) + count));
    }
    return frameFromTotals(inputs[0].time, width, totals);
  };
  const root = Object.freeze({ cell: cell(children[0].root.cell.min, width),
    population: safeCount(children[0].root.population + children[1].root.population),
    forward: merge('forwardSteps'), backward: merge('backwardSteps') });
  return Object.freeze({ children, root });
}

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
function pair<T>(a: T, b: T): readonly [T, T] { return Object.freeze([a, b]); }
function safeCount(count: number): number {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Population exceeds safe-integer counts');
  return count;
}
