import { LRUCache } from 'lru-cache';
import { multinomial } from '../../utils/distributions/multinomial';
import {
  createAddressedRandom,
  type AddressedRandom,
  type Seed,
} from '../../utils/rng/addressedRandom';
import { classifyCell, classifyFlow, classifyTwoStageFlow } from './classifiers';
import {
  coarseFlowCount,
  createBirdsCoarseInitialization,
  type BirdsCoarseInitialization,
} from './coarseInitialization';
import type { BirdCell, BirdFlow, BirdTwoStageFlow } from './entities';
import {
  isPossibleFlow,
  midpointCellProbabilities,
  possibleParentFlows,
} from './motionSupport';
import { classifyFlowTimeSubdivisionOwner } from './ownerClassifiers';

export const BIRDS_FLOW_CACHE_CAPACITY = 50_000;
export const BIRDS_TEMPORAL_BATCH_CACHE_CAPACITY = 20_000;

export interface TemporalSubdivisionEntry {
  readonly midpointCell: BirdCell;
  readonly count: number;
}

export interface TemporalSubdivisionResult {
  readonly parentCount: number;
  readonly entries: readonly TemporalSubdivisionEntry[];
}

export interface BirdsEngineStats {
  readonly cacheHits: number;
  readonly flowsEvaluated: number;
  readonly maximumDepth: number;
  readonly temporalBatchesEvaluated: number;
  readonly twoStageEntriesEvaluated: number;
}

interface MutableStats {
  cacheHits: number;
  flowsEvaluated: number;
  maximumDepth: number;
  temporalBatchesEvaluated: number;
  twoStageEntriesEvaluated: number;
}

export interface BirdsEngineOptions {
  readonly flowCacheCapacity?: number;
  readonly temporalBatchCacheCapacity?: number;
}

/** Internal stochastic Birds hierarchy. Currently evaluates coarse facts and Stages A–D. */
export class BirdsEngine {
  readonly #diffusionRate: number;
  readonly #initialization: BirdsCoarseInitialization;
  readonly #random: AddressedRandom;
  readonly #flowCache: LRUCache<string, number>;
  readonly #temporalBatchCache: LRUCache<string, TemporalSubdivisionResult>;
  #lastQueryStats: BirdsEngineStats = emptyStats();

  constructor(
    seed: Seed,
    populationDensity: number,
    diffusionRate: number,
    options: BirdsEngineOptions = {},
  ) {
    this.#diffusionRate = diffusionRate;
    this.#initialization = createBirdsCoarseInitialization(
      populationDensity,
      diffusionRate,
    );
    this.#random = createAddressedRandom(seed);
    this.#flowCache = new LRUCache({
      max: options.flowCacheCapacity ?? BIRDS_FLOW_CACHE_CAPACITY,
    });
    this.#temporalBatchCache = new LRUCache({
      max: options.temporalBatchCacheCapacity ?? BIRDS_TEMPORAL_BATCH_CACHE_CAPACITY,
    });
  }

  queryCell(cell: BirdCell): number {
    const construction = classifyCell(cell);
    if (construction === undefined) throw new RangeError('Invalid Birds cell geometry');
    if (construction.kind !== 'coarse-initialized') {
      throw new Error(`Birds cell construction ${construction.stage} is not implemented`);
    }
    this.#lastQueryStats = emptyStats();
    return this.#initialization.cellPopulation;
  }

  queryFlow(flow: BirdFlow): number {
    const stats = emptyStats();
    const count = this.#queryFlow(flow, stats, 0);
    this.#lastQueryStats = stats;
    return count;
  }

  queryTwoStageFlow(flow: BirdTwoStageFlow): number {
    const stats = emptyStats();
    const count = this.#queryTwoStageFlow(flow, stats, 0);
    this.#lastQueryStats = stats;
    return count;
  }

  queryFlowTimeSubdivision(flow: BirdFlow): TemporalSubdivisionResult {
    if (classifyFlowTimeSubdivisionOwner(flow) === undefined) {
      throw new RangeError('Flow does not own a Birds temporal subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryFlowTimeSubdivision(flow, stats, 0);
    this.#lastQueryStats = stats;
    return result;
  }

  getLastQueryStats(): BirdsEngineStats {
    return this.#lastQueryStats;
  }

  getCacheUsage(): {
    readonly capacity: number;
    readonly entries: number;
  } {
    return {
      capacity: this.#flowCache.max + this.#temporalBatchCache.max,
      entries: this.#flowCache.size + this.#temporalBatchCache.size,
    };
  }

  clearCache(): void {
    this.#flowCache.clear();
    this.#temporalBatchCache.clear();
  }

  #queryFlow(flow: BirdFlow, stats: MutableStats, depth: number): number {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const construction = classifyFlow(flow);
    if (construction === undefined) throw new RangeError('Invalid Birds flow geometry');
    if (!isPossibleFlow(flow, this.#diffusionRate)) return 0;

    const key = flowKey(flow);
    const cached = this.#flowCache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.flowsEvaluated += 1;
    let count: number;
    switch (construction.kind) {
      case 'coarse-initialized':
        count = coarseFlowCount(this.#initialization, construction.coarseKernelOffset);
        break;

      case 'temporal-aggregation':
        count = possibleParentFlows(flow, this.#diffusionRate).reduce(
          (sum, parentFlow) =>
            sum +
            this.#queryTwoStageFlow(
              construction.leg === 'first'
                ? {
                    source: flow.source,
                    midpoint: flow.destination,
                    destination: parentFlow.destination,
                  }
                : {
                    source: parentFlow.source,
                    midpoint: flow.source,
                    destination: flow.destination,
                  },
              stats,
              depth + 1,
            ),
          0,
        );
        break;

      default:
        throw new Error(`Birds flow construction ${construction.stage} is not implemented`);
    }

    this.#flowCache.set(key, count);
    return count;
  }

  #queryTwoStageFlow(
    flow: BirdTwoStageFlow,
    stats: MutableStats,
    depth: number,
  ): number {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const construction = classifyTwoStageFlow(flow);
    if (construction === undefined) {
      throw new RangeError('Invalid Birds two-stage flow geometry');
    }
    stats.twoStageEntriesEvaluated += 1;
    const batch = this.#queryFlowTimeSubdivision(construction.parentFlow, stats, depth + 1);
    return (
      batch.entries.find(({ midpointCell }) => cellsEqual(midpointCell, flow.midpoint))?.count ?? 0
    );
  }

  #queryFlowTimeSubdivision(
    flow: BirdFlow,
    stats: MutableStats,
    depth: number,
  ): TemporalSubdivisionResult {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyFlowTimeSubdivisionOwner(flow);
    if (owner === undefined) {
      throw new RangeError('Flow does not own a Birds temporal subdivision');
    }

    const key = temporalBatchKey(flow);
    const cached = this.#temporalBatchCache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.temporalBatchesEvaluated += 1;
    const parentCount = this.#queryFlow(flow, stats, depth + 1);
    const categories = midpointCellProbabilities(flow, this.#diffusionRate);
    const counts =
      categories.length === 0
        ? []
        : multinomial(
            this.#random,
            temporalBatchAddress(flow, owner.stage),
            parentCount,
            categories.map(({ cell, probability }) => ({
              probability,
              address: ['midpoint-cell', cell.min, cell.max, cell.time],
            })),
          );
    const result: TemporalSubdivisionResult = {
      parentCount,
      entries: categories.map(({ cell }, index) => ({
        midpointCell: cell,
        count: counts[index],
      })),
    };
    this.#temporalBatchCache.set(key, result);
    return result;
  }
}

function flowKey(flow: BirdFlow): string {
  return `${cellKey(flow.source)}>${cellKey(flow.destination)}`;
}

function temporalBatchKey(flow: BirdFlow): string {
  return `temporal:${flowKey(flow)}`;
}

function cellKey(cell: BirdCell): string {
  return `${cell.min}:${cell.max}@${cell.time}`;
}

function temporalBatchAddress(flow: BirdFlow, stage: 'A' | 'C') {
  return [
    'birds.temporal-subdivision',
    stage,
    flow.source.min,
    flow.source.max,
    flow.source.time,
    flow.destination.min,
    flow.destination.max,
    flow.destination.time,
  ] as const;
}

function cellsEqual(left: BirdCell, right: BirdCell): boolean {
  return left.min === right.min && left.max === right.max && left.time === right.time;
}

function emptyStats(): MutableStats {
  return {
    cacheHits: 0,
    flowsEvaluated: 0,
    maximumDepth: 0,
    temporalBatchesEvaluated: 0,
    twoStageEntriesEvaluated: 0,
  };
}
