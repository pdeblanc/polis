import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { halfBinomialQuantile, type HalfBinomialQuantile } from './halfBinomial';
import type { Address } from '../utils/rng/address';
import { prefixRandom, type AddressedRandom } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';

// Fixed per process, never adapted to a query's population or probabilities.
export const POISSON_MATERIALIZATION_COUNT = 4;
// Optional experiment: scope setup does not consistently pay off on sparse workloads.
export const POISSON_CACHE_OPERATION_TAGS = false;

interface Interval {
  start: number;
  width: number;
  count: number;
  points?: number[];
  children?: [Interval, Interval];
}

/** One-sided unit-rate Poisson process; research prototype with untruncated samplers.
 * Independent roots cover [0,1), [1,2), [2,4), ... . A parent owns its binary split.
 * Small cells own fixed uniform points, so query order cannot change their positions.
 */
export class PoissonCountProcess {
  readonly stats = {
    poissonSamples: 0, binomialSamples: 0, uniforms: 0, nodes: 0,
    materializedPoints: 0, visits: 0, poissonMilliseconds: 0, binomialMilliseconds: 0,
    poissonScalarMilliseconds: 0, binomialScalarMilliseconds: 0,
  };
  readonly #roots = new Map<number, Interval>();
  // Entry i is the total population of roots strictly before root i.
  readonly #rootPrefixes = [0];
  readonly #random: AddressedRandom;
  readonly #operations?: Partial<Record<'root' | 'split' | 'points', AddressedRandom>>;
  readonly #profile: boolean;
  readonly #materializationCount: number;
  readonly #splitQuantile: HalfBinomialQuantile;

  constructor(random: AddressedRandom, address: Address, profile = false, materializationCount = POISSON_MATERIALIZATION_COUNT,
    splitQuantile: HalfBinomialQuantile = halfBinomialQuantile, cacheOperationTags = POISSON_CACHE_OPERATION_TAGS) {
    if (!Number.isSafeInteger(materializationCount) || materializationCount < 1) {
      throw new RangeError('Materialization cutoff must be a positive safe integer');
    }
    this.#random = prefixRandom(random, address);
    if (cacheOperationTags) this.#operations = {};
    this.#profile = profile;
    this.#materializationCount = materializationCount;
    this.#splitQuantile = splitQuantile;
  }

  clearCache(): void {
    this.#roots.clear();
    this.#rootPrefixes.length = 1;
  }

  /** Count points in [0,t). */
  countBefore(t: number, rootSearch: 'cached' | 'scan' = 'cached'): number {
    if (!Number.isFinite(t) || t < 0) throw new RangeError('Invalid count-process time');
    if (rootSearch === 'scan') return this.#scanBefore(t);
    if (t === 0) return 0;
    let index = t <= 1 ? 0 : Math.ceil(Math.log2(t));
    // log2 can round onto an integer at adjacent floats around powers of two.
    // At an exact boundary use the preceding root, avoiding any new random draw.
    if (t > 2 ** index) index++;
    else if (index > 0 && t <= 2 ** (index - 1)) index--;
    while (this.#rootPrefixes.length <= index) {
      const previous = this.#rootPrefixes.length - 1;
      const total = this.#rootPrefixes[previous] + this.#root(previous).count;
      if (!Number.isSafeInteger(total)) throw new RangeError('Poisson prefix exceeds safe count');
      this.#rootPrefixes.push(total);
    }
    const total = this.#rootPrefixes[index] + this.#prefix(this.#root(index), t);
    if (!Number.isSafeInteger(total)) throw new RangeError('Poisson prefix exceeds safe count');
    return total;
  }

  /** Retained as an experimental benchmark/reference path. */
  #scanBefore(t: number): number {
    let total = 0;
    for (let root = 0; ; root++) {
      const start = root === 0 ? 0 : 2 ** (root - 1);
      if (t <= start) return total;
      const cell = this.#root(root);
      total += this.#prefix(cell, t);
      if (!Number.isSafeInteger(total)) throw new RangeError('Poisson prefix exceeds safe count');
      if (t <= cell.start + cell.width) return total;
    }
  }

  /** Reference access by arrival index; does not resample any part of the process. */
  arrival(index: number): number {
    if (!Number.isSafeInteger(index) || index < 1) throw new RangeError('Invalid arrival index');
    let remaining = index;
    // This cap detects numeric exhaustion, not an assumed minimum arrival density.
    for (let root = 0; root < 1024; root++) {
      let cell = this.#root(root);
      if (remaining > cell.count) { remaining -= cell.count; continue; }
      while (cell.count > this.#materializationCount) {
        const [left, right] = this.#children(cell);
        if (remaining <= left.count) cell = left;
        else { remaining -= left.count; cell = right; }
      }
      return this.#points(cell)[remaining - 1];
    }
    throw new RangeError('Poisson arrival root search exhausted');
  }

  #uniform(tag: 'root' | 'split' | 'points', start: number, width: number, index?: number): number {
    this.stats.uniforms++;
    if (!this.#operations) return uniformUnit(this.#random,
      index === undefined ? [tag, start, width] : [tag, start, width, index]);
    // Build only operation scopes that are actually used, preserving flat addresses.
    const random = this.#operations[tag] ??= prefixRandom(this.#random, [tag]);
    return uniformUnit(random, index === undefined ? [start, width] : [start, width, index]);
  }

  #root(index: number): Interval {
    const cached = this.#roots.get(index);
    if (cached) return cached;
    const start = index === 0 ? 0 : 2 ** (index - 1);
    const width = index === 0 ? 1 : start;
    if (!Number.isFinite(start + width)) throw new RangeError('Poisson root overflow');
    const begin = this.#profile ? performance.now() : 0;
    const u = this.#uniform('root', start, width);
    const scalarBegin = this.#profile ? performance.now() : 0;
    const count = poissonQuantile(u, width);
    if (this.#profile) {
      const end = performance.now();
      this.stats.poissonMilliseconds += end - begin;
      this.stats.poissonScalarMilliseconds += end - scalarBegin;
    }
    this.stats.poissonSamples++;
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid Poisson count');
    const cell = this.#cell(start, width, count);
    this.#roots.set(index, cell);
    return cell;
  }

  #cell(start: number, width: number, count: number): Interval {
    this.stats.nodes++;
    return { start, width, count };
  }

  // Ownership depends on count, not whether a query has requested coordinates yet.
  // Keep the eager construction's addresses so deferring work preserves every point.
  #points(cell: Interval): number[] {
    if (cell.points === undefined) {
      const { start, width, count } = cell;
      cell.points = Array.from({ length: count }, (_, i) => {
        const point = start + width * this.#uniform('points', start, width, i);
        if (point < start || point >= start + width) throw new RangeError('Point rounded outside its cell');
        return point;
      }).sort((a, b) => a - b);
      this.stats.materializedPoints += count;
    }
    return cell.points;
  }

  #children(cell: Interval): [Interval, Interval] {
    if (cell.children) return cell.children;
    if (cell.count <= this.#materializationCount) throw new Error('Materialization-owned cells need no subdivision');
    const half = cell.width / 2;
    const mid = cell.start + half;
    if (mid === cell.start || mid === cell.start + cell.width) throw new RangeError('Poisson refinement exhausted');
    const begin = this.#profile ? performance.now() : 0;
    const u = this.#uniform('split', cell.start, cell.width);
    const scalarBegin = this.#profile ? performance.now() : 0;
    const left = this.#splitQuantile(u, cell.count);
    if (this.#profile) {
      const end = performance.now();
      this.stats.binomialMilliseconds += end - begin;
      this.stats.binomialScalarMilliseconds += end - scalarBegin;
    }
    this.stats.binomialSamples++;
    if (!Number.isSafeInteger(left) || left < 0 || left > cell.count) throw new RangeError('Invalid binomial split');
    cell.children = [this.#cell(cell.start, half, left), this.#cell(mid, half, cell.count - left)];
    return cell.children;
  }

  #prefix(cell: Interval, t: number): number {
    this.stats.visits++;
    if (t <= cell.start) return 0;
    if (t >= cell.start + cell.width) return cell.count;
    if (cell.count === 0) return 0;
    if (cell.count <= this.#materializationCount) {
      const points = this.#points(cell);
      let lo = 0;
      let hi = points.length;
      while (lo < hi) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (points[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }
    const [left, right] = this.#children(cell);
    return t <= right.start ? this.#prefix(left, t) : left.count + this.#prefix(right, t);
  }
}

export interface CountRaceCategory {
  readonly id: string;
  readonly probability: number;
  readonly path: { countBefore(t: number): number };
}

/** Search a common race-time cutoff. No fixed worst-case refinement bound is claimed:
 * close/rounded coincident arrivals can leave no representable cutoff with total n.
 */
export function countPoissonRace(
  n: number, categories: readonly CountRaceCategory[], stats = { cutoffs: 0 },
  search: 'count-guided' | 'bisection' = 'count-guided',
): number[] {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Invalid race population');
  if (!categories.length || new Set(categories.map((c) => c.id)).size !== categories.length ||
      categories.some((c) => !Number.isFinite(c.probability) || c.probability < 0) ||
      Math.abs(categories.reduce((s, c) => s + c.probability, 0) - 1) > 1e-12) {
    throw new RangeError('Invalid race categories');
  }
  if (!n) return categories.map(() => 0);
  let lo = 0;
  let hi: number | undefined;
  let t = n;
  const target = BigInt(n);
  for (let iteration = 0; iteration < 2048; iteration++) {
    stats.cutoffs++;
    const counts = categories.map((c) => c.probability ? c.path.countBefore(c.probability * t) : 0);
    const sum = counts.reduce((s, c) => {
      if (!Number.isSafeInteger(c) || c < 0) throw new RangeError('Invalid process count');
      return s + BigInt(c);
    }, 0n);
    if (sum === target) return counts;
    if (sum < target) lo = t;
    else hi = t;
    // The superposed process has rate 1. Use the population error to predict a
    // better cutoff, but never leave the bracket. Every third step uses the old
    // search to guarantee progress across empty gaps or unusually dense clusters.
    const predicted = t + Number(target - sum);
    const fallback = hi === undefined ? t * 2 : lo + (hi - lo) / 2;
    t = search === 'count-guided' && iteration % 3 !== 2 &&
      Number.isFinite(predicted) && predicted > lo && (hi === undefined || predicted < hi)
      ? predicted : fallback;
    if (!Number.isFinite(t) || t === lo || t === hi) {
      throw new RangeError('No representable race cutoff');
    }
  }
  throw new RangeError('Race cutoff search budget exceeded');
}
