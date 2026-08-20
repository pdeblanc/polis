import { LRUCache } from 'lru-cache';
import { binomial } from '../../utils/distributions/binomial';
import { hypergeometric } from '../../utils/distributions/hypergeometric';
import { multinomial } from '../../utils/distributions/multinomial';
import { multivariateHypergeometric } from '../../utils/distributions/multivariateHypergeometric';
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
  possibleFlowDestinations,
  possibleFlowSources,
  possibleParentFlows,
} from './motionSupport';
import {
  classifyCellSubdivisionOwner,
  classifyCellInflowSubdivisionOwner,
  classifyCellOutflowSubdivisionOwner,
  classifyFlowSpaceSubdivisionOwner,
  classifyFlowTimeSubdivisionOwner,
} from './ownerClassifiers';

export const BIRDS_FLOW_CACHE_CAPACITY = 50_000;
export const BIRDS_TEMPORAL_BATCH_CACHE_CAPACITY = 20_000;
export const BIRDS_CELL_CACHE_CAPACITY = 50_000;
export const BIRDS_CELL_SUBDIVISION_CACHE_CAPACITY = 20_000;
export const BIRDS_CELL_INCIDENCE_CACHE_CAPACITY = 20_000;
export const BIRDS_FLOW_RECONCILIATION_CACHE_CAPACITY = 20_000;

export interface TemporalSubdivisionEntry {
  readonly midpointCell: BirdCell;
  readonly count: number;
}

export interface TemporalSubdivisionResult {
  readonly parentCount: number;
  readonly entries: readonly TemporalSubdivisionEntry[];
}

export interface CellSubdivisionResult {
  readonly parentCount: number;
  readonly children: readonly [
    { readonly cell: BirdCell; readonly count: number },
    { readonly cell: BirdCell; readonly count: number },
  ];
}

export interface CellIncidenceSubdivisionEntry {
  readonly flow: BirdFlow;
  readonly count: number;
}

export interface CellIncidenceSubdivisionResult {
  readonly parentCellCount: number;
  readonly entries: readonly CellIncidenceSubdivisionEntry[];
}

export interface FlowSpaceSubdivisionEntry {
  readonly flow: BirdFlow;
  readonly count: number;
}

export interface FlowSpaceSubdivisionResult {
  readonly parentCount: number;
  readonly entries: readonly [
    FlowSpaceSubdivisionEntry,
    FlowSpaceSubdivisionEntry,
    FlowSpaceSubdivisionEntry,
    FlowSpaceSubdivisionEntry,
  ];
}

export interface BirdsEngineStats {
  readonly cacheHits: number;
  readonly cellsEvaluated: number;
  readonly cellSubdivisionsEvaluated: number;
  readonly incidenceBatchesEvaluated: number;
  readonly flowReconciliationsEvaluated: number;
  readonly flowsEvaluated: number;
  readonly maximumDepth: number;
  readonly temporalBatchesEvaluated: number;
  readonly twoStageEntriesEvaluated: number;
}

interface MutableStats {
  cacheHits: number;
  cellsEvaluated: number;
  cellSubdivisionsEvaluated: number;
  incidenceBatchesEvaluated: number;
  flowReconciliationsEvaluated: number;
  flowsEvaluated: number;
  maximumDepth: number;
  temporalBatchesEvaluated: number;
  twoStageEntriesEvaluated: number;
}

export interface BirdsEngineOptions {
  readonly flowCacheCapacity?: number;
  readonly temporalBatchCacheCapacity?: number;
  readonly cellCacheCapacity?: number;
  readonly cellSubdivisionCacheCapacity?: number;
  readonly cellIncidenceCacheCapacity?: number;
  readonly flowReconciliationCacheCapacity?: number;
}

/** Internal stochastic Birds hierarchy for the complete inward refinement recurrence. */
export class BirdsEngine {
  readonly #diffusionRate: number;
  readonly #initialization: BirdsCoarseInitialization;
  readonly #random: AddressedRandom;
  readonly #flowCache: LRUCache<string, number>;
  readonly #temporalBatchCache: LRUCache<string, TemporalSubdivisionResult>;
  readonly #cellCache: LRUCache<string, number>;
  readonly #cellSubdivisionCache: LRUCache<string, CellSubdivisionResult>;
  readonly #cellOutflowSubdivisionCache: LRUCache<string, CellIncidenceSubdivisionResult>;
  readonly #cellInflowSubdivisionCache: LRUCache<string, CellIncidenceSubdivisionResult>;
  readonly #flowSpaceSubdivisionCache: LRUCache<string, FlowSpaceSubdivisionResult>;
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
    this.#cellCache = new LRUCache({
      max: options.cellCacheCapacity ?? BIRDS_CELL_CACHE_CAPACITY,
    });
    this.#cellSubdivisionCache = new LRUCache({
      max: options.cellSubdivisionCacheCapacity ?? BIRDS_CELL_SUBDIVISION_CACHE_CAPACITY,
    });
    this.#cellOutflowSubdivisionCache = new LRUCache({
      max: options.cellIncidenceCacheCapacity ?? BIRDS_CELL_INCIDENCE_CACHE_CAPACITY,
    });
    this.#cellInflowSubdivisionCache = new LRUCache({
      max: options.cellIncidenceCacheCapacity ?? BIRDS_CELL_INCIDENCE_CACHE_CAPACITY,
    });
    this.#flowSpaceSubdivisionCache = new LRUCache({
      max:
        options.flowReconciliationCacheCapacity ??
        BIRDS_FLOW_RECONCILIATION_CACHE_CAPACITY,
    });
  }

  queryCell(cell: BirdCell): number {
    const stats = emptyStats();
    const count = this.#queryCell(cell, stats, 0);
    this.#lastQueryStats = stats;
    return count;
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

  queryCellSubdivision(cell: BirdCell): CellSubdivisionResult {
    if (classifyCellSubdivisionOwner(cell) === undefined) {
      throw new RangeError('Cell does not own a Birds spatial subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryCellSubdivision(cell, stats, 0);
    this.#lastQueryStats = stats;
    return result;
  }

  queryCellOutflowSubdivision(cell: BirdCell): CellIncidenceSubdivisionResult {
    if (classifyCellOutflowSubdivisionOwner(cell) === undefined) {
      throw new RangeError('Cell does not own a Birds outflow subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryCellOutflowSubdivision(cell, stats, 0);
    this.#lastQueryStats = stats;
    return result;
  }

  queryCellInflowSubdivision(cell: BirdCell): CellIncidenceSubdivisionResult {
    if (classifyCellInflowSubdivisionOwner(cell) === undefined) {
      throw new RangeError('Cell does not own a Birds inflow subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryCellInflowSubdivision(cell, stats, 0);
    this.#lastQueryStats = stats;
    return result;
  }

  queryFlowSpaceSubdivision(flow: BirdFlow): FlowSpaceSubdivisionResult {
    if (classifyFlowSpaceSubdivisionOwner(flow) === undefined) {
      throw new RangeError('Flow does not own a Birds spatial subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryFlowSpaceSubdivision(flow, stats, 0);
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
      capacity:
        this.#flowCache.max +
        this.#temporalBatchCache.max +
        this.#cellCache.max +
        this.#cellSubdivisionCache.max +
        this.#cellOutflowSubdivisionCache.max +
        this.#cellInflowSubdivisionCache.max +
        this.#flowSpaceSubdivisionCache.max,
      entries:
        this.#flowCache.size +
        this.#temporalBatchCache.size +
        this.#cellCache.size +
        this.#cellSubdivisionCache.size +
        this.#cellOutflowSubdivisionCache.size +
        this.#cellInflowSubdivisionCache.size +
        this.#flowSpaceSubdivisionCache.size,
    };
  }

  clearCache(): void {
    this.#flowCache.clear();
    this.#temporalBatchCache.clear();
    this.#cellCache.clear();
    this.#cellSubdivisionCache.clear();
    this.#cellOutflowSubdivisionCache.clear();
    this.#cellInflowSubdivisionCache.clear();
    this.#flowSpaceSubdivisionCache.clear();
  }

  #queryCell(cell: BirdCell, stats: MutableStats, depth: number): number {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const construction = classifyCell(cell);
    if (construction === undefined) throw new RangeError('Invalid Birds cell geometry');

    const key = cellKey(cell);
    const cached = this.#cellCache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.cellsEvaluated += 1;
    let count: number;
    switch (construction.kind) {
      case 'coarse-initialized':
        count = this.#initialization.cellPopulation;
        break;

      case 'temporally-introduced': {
        const length = cell.max - cell.min;
        count = possibleFlowDestinations(
          cell,
          construction.outgoingDuration,
          this.#diffusionRate,
        )
          .filter((destination) => destination.max - destination.min === length)
          .reduce(
            (sum, destination) =>
              sum + this.#queryFlow({ source: cell, destination }, stats, depth + 1),
            0,
          );
        break;
      }

      case 'spatial-child': {
        const subdivision = this.#queryCellSubdivision(
          construction.subdivisionOwner,
          stats,
          depth + 1,
        );
        count = subdivision.children[construction.childIndex].count;
        break;
      }
    }

    this.#cellCache.set(key, count);
    return count;
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

      case 'source-spatial-child': {
        const batch = this.#queryCellOutflowSubdivision(
          construction.subdivisionOwner,
          stats,
          depth + 1,
        );
        count = findFlowCount(batch.entries, flow);
        break;
      }

      case 'destination-spatial-child': {
        const batch = this.#queryCellInflowSubdivision(
          construction.subdivisionOwner,
          stats,
          depth + 1,
        );
        count = findFlowCount(batch.entries, flow);
        break;
      }

      case 'fully-spatially-refined': {
        const batch = this.#queryFlowSpaceSubdivision(
          construction.subdivisionOwner,
          stats,
          depth + 1,
        );
        count = findFlowCount(batch.entries, flow);
        break;
      }
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

  #queryCellSubdivision(
    cell: BirdCell,
    stats: MutableStats,
    depth: number,
  ): CellSubdivisionResult {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyCellSubdivisionOwner(cell);
    if (owner === undefined) {
      throw new RangeError('Cell does not own a Birds spatial subdivision');
    }

    const key = `cell-subdivision:${cellKey(cell)}`;
    const cached = this.#cellSubdivisionCache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.cellSubdivisionsEvaluated += 1;
    const parentCount = this.#queryCell(cell, stats, depth + 1);
    const leftCount = binomial(
      this.#random,
      ['birds.cell-subdivision', cell.min, cell.max, cell.time, 'left-child'],
      parentCount,
      0.5,
    );
    const result: CellSubdivisionResult = {
      parentCount,
      children: [
        { cell: owner.children[0], count: leftCount },
        { cell: owner.children[1], count: parentCount - leftCount },
      ],
    };
    this.#cellSubdivisionCache.set(key, result);
    return result;
  }

  #queryCellOutflowSubdivision(
    cell: BirdCell,
    stats: MutableStats,
    depth: number,
  ): CellIncidenceSubdivisionResult {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyCellOutflowSubdivisionOwner(cell);
    if (owner === undefined) {
      throw new RangeError('Cell does not own a Birds outflow subdivision');
    }

    const key = `outflow-subdivision:${cellKey(cell)}`;
    const cached = this.#cellOutflowSubdivisionCache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.incidenceBatchesEvaluated += 1;
    const parentFlows = possibleFlowDestinations(
      cell,
      owner.flowDuration,
      this.#diffusionRate,
    )
      .filter((destination) => destination.max - destination.min === owner.destinationCellLength)
      .map((destination) => ({ source: cell, destination }));
    const capacities = parentFlows.map((flow) => this.#queryFlow(flow, stats, depth + 1));
    const subdivision = this.#queryCellSubdivision(cell, stats, depth + 1);
    const leftCounts = multivariateHypergeometric(
      this.#random,
      ['birds.cell-outflow-subdivision', cell.min, cell.max, cell.time],
      parentFlows.map((flow, index) => ({
        capacity: capacities[index],
        address: ['destination-cell', flow.destination.min, flow.destination.max, flow.destination.time],
      })),
      subdivision.children[0].count,
    );
    const entries: CellIncidenceSubdivisionEntry[] = [];
    for (let index = 0; index < parentFlows.length; index += 1) {
      entries.push({
        flow: { source: owner.sourceChildren[0], destination: parentFlows[index].destination },
        count: leftCounts[index],
      });
      entries.push({
        flow: { source: owner.sourceChildren[1], destination: parentFlows[index].destination },
        count: capacities[index] - leftCounts[index],
      });
    }
    const result = { parentCellCount: subdivision.parentCount, entries };
    this.#cellOutflowSubdivisionCache.set(key, result);
    return result;
  }

  #queryCellInflowSubdivision(
    cell: BirdCell,
    stats: MutableStats,
    depth: number,
  ): CellIncidenceSubdivisionResult {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyCellInflowSubdivisionOwner(cell);
    if (owner === undefined) {
      throw new RangeError('Cell does not own a Birds inflow subdivision');
    }

    const key = `inflow-subdivision:${cellKey(cell)}`;
    const cached = this.#cellInflowSubdivisionCache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.incidenceBatchesEvaluated += 1;
    const parentFlows = possibleFlowSources(
      cell,
      owner.flowDuration,
      this.#diffusionRate,
    )
      .filter((source) => source.max - source.min === owner.sourceCellLength)
      .map((source) => ({ source, destination: cell }));
    const capacities = parentFlows.map((flow) => this.#queryFlow(flow, stats, depth + 1));
    const subdivision = this.#queryCellSubdivision(cell, stats, depth + 1);
    const leftCounts = multivariateHypergeometric(
      this.#random,
      ['birds.cell-inflow-subdivision', cell.min, cell.max, cell.time],
      parentFlows.map((flow, index) => ({
        capacity: capacities[index],
        address: ['source-cell', flow.source.min, flow.source.max, flow.source.time],
      })),
      subdivision.children[0].count,
    );
    const entries: CellIncidenceSubdivisionEntry[] = [];
    for (let index = 0; index < parentFlows.length; index += 1) {
      entries.push({
        flow: { source: parentFlows[index].source, destination: owner.destinationChildren[0] },
        count: leftCounts[index],
      });
      entries.push({
        flow: { source: parentFlows[index].source, destination: owner.destinationChildren[1] },
        count: capacities[index] - leftCounts[index],
      });
    }
    const result = { parentCellCount: subdivision.parentCount, entries };
    this.#cellInflowSubdivisionCache.set(key, result);
    return result;
  }

  #queryFlowSpaceSubdivision(
    flow: BirdFlow,
    stats: MutableStats,
    depth: number,
  ): FlowSpaceSubdivisionResult {
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyFlowSpaceSubdivisionOwner(flow);
    if (owner === undefined) {
      throw new RangeError('Flow does not own a Birds spatial subdivision');
    }

    const key = `flow-space-subdivision:${flowKey(flow)}`;
    const cached = this.#flowSpaceSubdivisionCache.get(key);
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.flowReconciliationsEvaluated += 1;
    const parentCount = this.#queryFlow(flow, stats, depth + 1);
    const outflowBatch = this.#queryCellOutflowSubdivision(flow.source, stats, depth + 1);
    const inflowBatch = this.#queryCellInflowSubdivision(flow.destination, stats, depth + 1);
    const firstRow = findFlowCount(outflowBatch.entries, {
      source: owner.sourceChildren[0],
      destination: flow.destination,
    });
    const firstColumn = findFlowCount(inflowBatch.entries, {
      source: flow.source,
      destination: owner.destinationChildren[0],
    });
    const upperLeft = hypergeometric(
      this.#random,
      [
        'birds.flow-space-subdivision',
        flow.source.min,
        flow.source.max,
        flow.source.time,
        flow.destination.min,
        flow.destination.max,
        flow.destination.time,
        'upper-left',
      ],
      parentCount,
      firstRow,
      firstColumn,
    );
    const counts = [
      upperLeft,
      firstRow - upperLeft,
      firstColumn - upperLeft,
      parentCount - firstRow - firstColumn + upperLeft,
    ] as const;
    const result: FlowSpaceSubdivisionResult = {
      parentCount,
      entries: [
        { flow: owner.childFlows[0], count: counts[0] },
        { flow: owner.childFlows[1], count: counts[1] },
        { flow: owner.childFlows[2], count: counts[2] },
        { flow: owner.childFlows[3], count: counts[3] },
      ],
    };
    this.#flowSpaceSubdivisionCache.set(key, result);
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

function flowsEqual(left: BirdFlow, right: BirdFlow): boolean {
  return cellsEqual(left.source, right.source) && cellsEqual(left.destination, right.destination);
}

function findFlowCount(
  entries: readonly { readonly flow: BirdFlow; readonly count: number }[],
  flow: BirdFlow,
): number {
  return entries.find((entry) => flowsEqual(entry.flow, flow))?.count ?? 0;
}

function emptyStats(): MutableStats {
  return {
    cacheHits: 0,
    cellsEvaluated: 0,
    cellSubdivisionsEvaluated: 0,
    incidenceBatchesEvaluated: 0,
    flowReconciliationsEvaluated: 0,
    flowsEvaluated: 0,
    maximumDepth: 0,
    temporalBatchesEvaluated: 0,
    twoStageEntriesEvaluated: 0,
  };
}
