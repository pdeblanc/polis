import QuickLRU from 'quick-lru';
import { brownianMarginalMass, type BrownianObservation } from '../../utils/math/brownianMarginal';
import { BirdsQueryApi } from '../birds/birdsQueryApi';
import { classifyBirds2aCellGeometry, type Birds2aCell, type Birds2aFlow } from './classifiers';
import type { ExpansionCell } from './expansion';
import { birds2QueryGeometry } from './queryBackend';

export const BIRDS_2A_MEANS_CACHE_CAPACITY = 20_000;

/** Ideal single-origin Poisson–Brownian marginal means, not a sampled world.
 * `count` fields in the shared API contain real-valued expectations. No seed is
 * needed. Incident-flow enumeration is unsupported: Brownian support is infinite.
 */
export class Birds2aMeans extends BirdsQueryApi {
  readonly #means: Birds2aMeanQueries;

  constructor(populationDensity: number, diffusionRate: number, origin: ExpansionCell = { min: 0, max: 1 }) {
    const means = new Birds2aMeanQueries(populationDensity, diffusionRate, origin);
    super({ ...birds2QueryGeometry(means), sources: unsupported, destinations: unsupported });
    this.#means = means;
  }

  /** Raw observation queries also cover expansion facts outside API resolutions. */
  queryCell(cell: Birds2aCell): number { return this.#means.queryCell(cell); }
  queryTemporalSplit(flow: Birds2aFlow, midpoint: Birds2aCell): number {
    return this.#means.queryTemporalSplit(flow, midpoint);
  }
  queryMarginal(observations: readonly BrownianObservation[]): number { return this.#means.queryMarginal(observations); }

  populationSupport(time: number): ExpansionCell {
    if (!Number.isFinite(time)) throw new RangeError('Expected finite time');
    return this.#means.diffusionRate === 0 || time === 0 ? { ...this.#means.origin } : { min: -Infinity, max: Infinity };
  }
}

/** Same scalar query shapes as the hierarchy engine, but independent of its
 * ownership, truncation, samplers and expansion records. Arbitrary finite
 * observation intervals/times are allowed for calibration, including 3T bridges.
 */
export class Birds2aMeanQueries {
  readonly origin: ExpansionCell;
  readonly #cache = new QuickLRU<string, number>({ maxSize: BIRDS_2A_MEANS_CACHE_CAPACITY });
  constructor(readonly populationDensity: number, readonly diffusionRate: number,
    origin: ExpansionCell = { min: 0, max: 1 }) {
    if ([populationDensity, diffusionRate].some((x) => !Number.isFinite(x) || x < 0)) throw new RangeError('Parameters must be finite and nonnegative');
    if (!classifyBirds2aCellGeometry({ ...origin, time: 0 })) throw new RangeError('Origin must be an aligned dyadic cell');
    this.origin = Object.freeze({ ...origin });
  }

  queryMarginal(observations: readonly BrownianObservation[]): number {
    // Validate even on cache hits: JSON encodes non-finite numbers as null.
    for (const cell of observations) {
      if (![cell.min, cell.max, cell.time].every(Number.isFinite) || cell.max <= cell.min) throw new RangeError('Invalid observation');
    }
    const ordered = [...observations].sort((a, b) => a.time - b.time || a.min - b.min || a.max - b.max);
    const key = JSON.stringify(ordered.map(({ min, max, time }) => [min, max, time]));
    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;
    const mean = this.populationDensity === 0 ? 0 : this.populationDensity * brownianMarginalMass(this.origin, ordered, this.diffusionRate);
    this.#cache.set(key, mean);
    return mean;
  }
  queryCell(cell: Birds2aCell): number { return this.queryMarginal([cell]); }
  queryCachedCell(cell: Birds2aCell): number | undefined {
    if (!classifyBirds2aCellGeometry(cell)) throw new RangeError('Invalid population cell');
    return this.#cache.peek(JSON.stringify([[cell.min, cell.max, cell.time]]));
  }
  queryFlow(flow: Birds2aFlow): number { return this.queryMarginal([flow.source, flow.destination]); }
  queryTemporalSplit(flow: Birds2aFlow, midpoint: Birds2aCell): number {
    if (!(midpoint.time > Math.min(flow.source.time, flow.destination.time) && midpoint.time < Math.max(flow.source.time, flow.destination.time))) {
      throw new RangeError('Midpoint must lie strictly between flow endpoints');
    }
    return this.queryMarginal([flow.source, midpoint, flow.destination]);
  }
  queryCellSubdivision(cell: Birds2aCell) {
    if (!classifyBirds2aCellGeometry(cell)) throw new RangeError('Invalid population cell');
    const mid = cell.min + (cell.max - cell.min) / 2;
    const sample = (child: Birds2aCell) => ({ cell: child, count: this.queryCell(child) });
    return { parentCount: this.queryCell(cell), children: [sample({ ...cell, max: mid }), sample({ ...cell, min: mid })] as const };
  }
  clearCache(): void { this.#cache.clear(); }
  getCacheUsage() { return { entries: this.#cache.size, capacity: BIRDS_2A_MEANS_CACHE_CAPACITY }; }
}

function unsupported(): never {
  throw new Error('Incident-flow enumeration is unsupported by Birds2aMeans: Brownian motion has unbounded support');
}
