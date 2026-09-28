import QuickLRU from 'quick-lru';
import type { Seed } from '../../utils/rng/addressedRandom';
import { Birds2aEngine } from '../birds2a/birds2aEngine';
import { classifyBirds2aCellGeometry, classifyBirds2aFlow, type Birds2aCell, type Birds2aFlow } from '../birds2a/classifiers';
import { Birds2aExpansion, EXPANSION_DEFAULT_CELL_WIDTH, type ExpansionCell } from '../birds2a/expansion';
import { createBirds2aMotionSupport, isPossibleBirds2aFlow } from '../birds2a/motionSupport';
import { birds2aPopulationSupport } from '../birds2a/populationSupport';
import { originChannelsIn, originSearchWindow } from './channels';

export const BIRDS_2B_FACT_CACHE_CAPACITY = 50_000;
export const BIRDS_2B_GEOMETRY_ORIGIN = Object.freeze({ min: 0, max: EXPANSION_DEFAULT_CELL_WIDTH });

/** Reference construction: sum independent origin channels, without moving any
 * stochastic refinement across summation. Origins already namespace all 2a RNG
 * addresses, so the same seed gives exactly the standalone 2a contributions.
 */
export class Birds2bEngine {
  readonly motionSupport;
  readonly #kernels: Birds2aExpansion['kernels'];
  readonly #seed: Seed;
  readonly #density: number;
  readonly #diffusion: number;
  readonly #channels = new Map<number, Birds2aEngine>();
  readonly #cells = new QuickLRU<string, number>({ maxSize: BIRDS_2B_FACT_CACHE_CAPACITY });
  readonly #flows = new QuickLRU<string, number>({ maxSize: BIRDS_2B_FACT_CACHE_CAPACITY });

  constructor(seed: Seed, density: number, diffusion: number) {
    // Kernel construction validates parameters but does not generate an epoch.
    this.#kernels = new Birds2aExpansion(seed, density, diffusion).kernels;
    this.motionSupport = createBirds2aMotionSupport(diffusion);
    this.#seed = seed; this.#density = density; this.#diffusion = diffusion;
  }

  candidateOrigins(cell: Birds2aCell): readonly ExpansionCell[] {
    return originChannelsIn(originSearchWindow(cell, this.motionSupport))
      .filter((origin) => this.#mayContribute(origin, cell));
  }

  queryCell(cell: Birds2aCell): number {
    if (!classifyBirds2aCellGeometry(cell)) throw new RangeError('Invalid Birds 2b cell');
    const key = cellKey(cell), cached = this.#cells.get(key);
    if (cached !== undefined) return cached;
    let count = 0;
    if (this.#density !== 0) for (const origin of this.candidateOrigins(cell)) {
      count = addCounts(count, this.#channel(origin).queryCell(cell));
    }
    this.#cells.set(key, count);
    return count;
  }

  queryCachedCell(cell: Birds2aCell): number | undefined {
    if (!classifyBirds2aCellGeometry(cell)) throw new RangeError('Invalid Birds 2b cell');
    // Only complete global results count as cached; never evaluate a missing channel.
    return this.#cells.peek(cellKey(cell));
  }

  queryCellSubdivision(cell: Birds2aCell) {
    const parentCount = this.queryCell(cell), middle = cell.min + (cell.max - cell.min) / 2;
    const left = { ...cell, max: middle }, right = { ...cell, min: middle };
    return { parentCount, children: [
      { cell: left, count: this.queryCell(left) }, { cell: right, count: this.queryCell(right) },
    ] as const };
  }

  queryFlow(flow: Birds2aFlow): number {
    if (!classifyBirds2aFlow(flow, BIRDS_2B_GEOMETRY_ORIGIN)) throw new RangeError('Invalid Birds 2b flow');
    const key = `${cellKey(flow.source)}:${cellKey(flow.destination)}`, cached = this.#flows.get(key);
    if (cached !== undefined) return cached;
    let count = 0;
    if (this.#density !== 0 && isPossibleBirds2aFlow(flow, BIRDS_2B_GEOMETRY_ORIGIN, this.motionSupport)) {
      for (const origin of this.candidateOrigins(flow.source)) if (this.#mayContribute(origin, flow.destination)) {
        count = addCounts(count, this.#channel(origin).queryFlow(flow));
      }
    }
    this.#flows.set(key, count);
    return count;
  }

  clearCache(): void {
    this.#cells.clear(); this.#flows.clear();
    for (const channel of this.#channels.values()) channel.clearCache();
  }

  getCacheUsage() {
    let entries = this.#cells.size + this.#flows.size, capacity = 2 * BIRDS_2B_FACT_CACHE_CAPACITY;
    for (const channel of this.#channels.values()) {
      const usage = channel.getCacheUsage(); entries += usage.entries; capacity += usage.capacity;
    }
    return { entries, capacity };
  }

  getChannelUsage() {
    let expansionEpochs = 0;
    for (const channel of this.#channels.values()) expansionEpochs += channel.expansion.retainedEpochCount;
    return { channels: this.#channels.size, expansionEpochs };
  }

  #mayContribute(origin: ExpansionCell, cell: Birds2aCell): boolean {
    const bound = birds2aPopulationSupport(origin, this.#kernels, this.motionSupport.midpointKernels, cell.time);
    // An unavailable numeric bound is not proof of absence.
    return bound === undefined || (bound.min < cell.max && cell.min < bound.max);
  }

  #channel(origin: ExpansionCell): Birds2aEngine {
    let channel = this.#channels.get(origin.min);
    if (!channel) {
      channel = new Birds2aEngine(this.#seed, this.#density, this.#diffusion, origin);
      this.#channels.set(origin.min, channel);
    }
    return channel;
  }
}

function cellKey(cell: Birds2aCell): string { return `${cell.min}:${cell.max}:${cell.time}`; }
function addCounts(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError('Birds 2b population exceeds exact integer precision');
  return result;
}
