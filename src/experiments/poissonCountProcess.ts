import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import binomialQuantile from '@stdlib/stats-base-dists-binomial-quantile';
import type { Address } from '../utils/rng/address';
import type { AddressedRandom } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';

const MATERIALIZATION_COUNT = 16;

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
  };
  readonly #roots = new Map<number, Interval>();
  readonly #random: AddressedRandom;
  readonly #address: Address;
  readonly #profile: boolean;

  constructor(random: AddressedRandom, address: Address, profile = false) {
    this.#random = random;
    this.#address = [...address];
    this.#profile = profile;
  }

  clearCache(): void { this.#roots.clear(); }

  /** Count points in [0,t). */
  countBefore(t: number): number {
    if (!Number.isFinite(t) || t < 0) throw new RangeError('Invalid count-process time');
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
      while (cell.points === undefined) {
        const [left, right] = this.#children(cell);
        if (remaining <= left.count) cell = left;
        else { remaining -= left.count; cell = right; }
      }
      return cell.points[remaining - 1];
    }
    throw new RangeError('Poisson arrival root search exhausted');
  }

  #uniform(suffix: Address): number {
    this.stats.uniforms++;
    return uniformUnit(this.#random, [...this.#address, ...suffix]);
  }

  #root(index: number): Interval {
    const cached = this.#roots.get(index);
    if (cached) return cached;
    const start = index === 0 ? 0 : 2 ** (index - 1);
    const width = index === 0 ? 1 : start;
    if (!Number.isFinite(start + width)) throw new RangeError('Poisson root overflow');
    const begin = this.#profile ? performance.now() : 0;
    const count = poissonQuantile(this.#uniform(['root', start, width]), width);
    if (this.#profile) this.stats.poissonMilliseconds += performance.now() - begin;
    this.stats.poissonSamples++;
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid Poisson count');
    const cell = this.#cell(start, width, count);
    this.#roots.set(index, cell);
    return cell;
  }

  #cell(start: number, width: number, count: number): Interval {
    this.stats.nodes++;
    const cell: Interval = { start, width, count };
    if (count <= MATERIALIZATION_COUNT) {
      cell.points = Array.from({ length: count }, (_, i) => {
        const point = start + width * this.#uniform(['points', start, width, i]);
        if (point < start || point >= start + width) throw new RangeError('Point rounded outside its cell');
        return point;
      }).sort((a, b) => a - b);
      this.stats.materializedPoints += count;
    }
    return cell;
  }

  #children(cell: Interval): [Interval, Interval] {
    if (cell.children) return cell.children;
    if (cell.points !== undefined) throw new Error('Materialized cells need no subdivision');
    const half = cell.width / 2;
    const mid = cell.start + half;
    if (mid === cell.start || mid === cell.start + cell.width) throw new RangeError('Poisson refinement exhausted');
    const begin = this.#profile ? performance.now() : 0;
    const left = binomialQuantile(this.#uniform(['split', cell.start, cell.width]), cell.count, 0.5);
    if (this.#profile) this.stats.binomialMilliseconds += performance.now() - begin;
    this.stats.binomialSamples++;
    if (!Number.isSafeInteger(left) || left < 0 || left > cell.count) throw new RangeError('Invalid binomial split');
    cell.children = [this.#cell(cell.start, half, left), this.#cell(mid, half, cell.count - left)];
    return cell.children;
  }

  #prefix(cell: Interval, t: number): number {
    this.stats.visits++;
    if (t <= cell.start) return 0;
    if (t >= cell.start + cell.width) return cell.count;
    if (cell.points !== undefined) {
      let lo = 0;
      let hi = cell.points.length;
      while (lo < hi) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (cell.points[mid] < t) lo = mid + 1;
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
  for (let iteration = 0; iteration < 2048; iteration++) {
    stats.cutoffs++;
    const counts = categories.map((c) => c.probability ? c.path.countBefore(c.probability * t) : 0);
    const sum = counts.reduce((s, c) => {
      if (!Number.isSafeInteger(c) || c < 0) throw new RangeError('Invalid process count');
      return s + BigInt(c);
    }, 0n);
    if (sum === BigInt(n)) return counts;
    if (sum < BigInt(n)) lo = t;
    else hi = t;
    t = hi === undefined ? t * 2 : lo + (hi - lo) / 2;
    if (!Number.isFinite(t) || t === lo || t === hi) {
      throw new RangeError('No representable race cutoff');
    }
  }
  throw new RangeError('Race cutoff search budget exceeded');
}
