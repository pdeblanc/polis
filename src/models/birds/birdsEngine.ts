import QuickLRU from 'quick-lru';
import type { BirdsCacheProfiler } from './cacheProfiling';
import { binomial } from '../../utils/distributions/binomial';
import { hypergeometric } from '../../utils/distributions/hypergeometric';
import { multinomial } from '../../utils/distributions/multinomial';
import { multivariateHypergeometric } from '../../utils/distributions/multivariateHypergeometric';
import {
  createAddressedRandom,
  type AddressedRandom,
  type Seed,
} from '../../utils/rng/addressedRandom';
import {
  classifyCanonicalCell,
  classifyCanonicalFlow,
  classifyCanonicalTwoStageFlow,
  classifyCell,
  classifyFlow,
  classifyTwoStageFlow,
} from './classifiers';
import {
  coarseFlowCount,
  createBirdsCoarseInitialization,
  type BirdsCoarseInitialization,
} from './coarseInitialization';
import type { BirdCell, BirdFlow, BirdTwoStageFlow } from './entities';
import {
  canonicalMidpointCellProbabilities,
  isPossibleCanonicalFlow,
  possibleCanonicalFlowDestinations,
  possibleCanonicalFlowSources,
  possibleCanonicalParentFlows,
} from './motionSupport';
import {
  classifyCanonicalCellInflowSubdivisionOwner,
  classifyCanonicalCellOutflowSubdivisionOwner,
  classifyCanonicalCellSubdivisionOwner,
  classifyCanonicalFlowSpaceSubdivisionOwner,
  classifyCanonicalFlowTimeSubdivisionOwner,
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
  readonly samplerCalls: number;
  readonly temporalBatchesEvaluated: number;
  readonly twoStageEntriesEvaluated: number;
}

export type BirdsDependencyNode =
  | { readonly role: 'cell'; readonly cell: BirdCell }
  | { readonly role: 'flow'; readonly flow: BirdFlow }
  | { readonly role: 'two-stage-flow'; readonly flow: BirdTwoStageFlow }
  | { readonly role: 'temporal-subdivision'; readonly flow: BirdFlow }
  | { readonly role: 'cell-subdivision'; readonly cell: BirdCell }
  | { readonly role: 'outflow-subdivision'; readonly cell: BirdCell }
  | { readonly role: 'inflow-subdivision'; readonly cell: BirdCell }
  | { readonly role: 'flow-space-subdivision'; readonly flow: BirdFlow };

export interface BirdsDependencyEdge {
  readonly dependent: BirdsDependencyNode;
  readonly dependency: BirdsDependencyNode;
}

interface MutableStats {
  cacheHits: number;
  cellsEvaluated: number;
  cellSubdivisionsEvaluated: number;
  incidenceBatchesEvaluated: number;
  flowReconciliationsEvaluated: number;
  flowsEvaluated: number;
  maximumDepth: number;
  samplerCalls: number;
  temporalBatchesEvaluated: number;
  twoStageEntriesEvaluated: number;
  readonly dependencyPath: BirdsDependencyNode[];
}

export interface BirdsEngineOptions {
  readonly cacheProfiler?: BirdsCacheProfiler;
  readonly flowCacheCapacity?: number;
  readonly temporalBatchCacheCapacity?: number;
  readonly cellCacheCapacity?: number;
  readonly cellSubdivisionCacheCapacity?: number;
  readonly cellIncidenceCacheCapacity?: number;
  readonly flowReconciliationCacheCapacity?: number;
  /** Diagnostic observer; query correctness never depends on its presence. */
  readonly observeDependency?: (edge: BirdsDependencyEdge) => void;
}

/** Internal stochastic Birds hierarchy for the complete inward refinement recurrence. */
export class BirdsEngine {
  readonly #diffusionRate: number;
  readonly #initialization: BirdsCoarseInitialization;
  readonly #random: AddressedRandom;
  readonly #flowCache: QuickLRU<string, number>;
  readonly #temporalBatchCache: QuickLRU<string, TemporalSubdivisionResult>;
  readonly #cellCache: QuickLRU<string, number>;
  readonly #cellSubdivisionCache: QuickLRU<string, CellSubdivisionResult>;
  readonly #cellOutflowSubdivisionCache: QuickLRU<string, CellIncidenceSubdivisionResult>;
  readonly #cellInflowSubdivisionCache: QuickLRU<string, CellIncidenceSubdivisionResult>;
  readonly #flowSpaceSubdivisionCache: QuickLRU<string, FlowSpaceSubdivisionResult>;
  readonly #cacheCapacity: number;
  readonly #observeDependency: ((edge: BirdsDependencyEdge) => void) | undefined;
  readonly #cacheProfiler: BirdsCacheProfiler | undefined;
  #lastQueryStats: BirdsEngineStats = emptyStats();
  #totalQueryStats: BirdsEngineStats = emptyStats();

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
    this.#observeDependency = options.observeDependency;
    this.#cacheProfiler = options.cacheProfiler;
    this.#flowCache = new QuickLRU({
      maxSize: options.flowCacheCapacity ?? BIRDS_FLOW_CACHE_CAPACITY,
    });
    this.#temporalBatchCache = new QuickLRU({
      maxSize: options.temporalBatchCacheCapacity ?? BIRDS_TEMPORAL_BATCH_CACHE_CAPACITY,
    });
    this.#cellCache = new QuickLRU({
      maxSize: options.cellCacheCapacity ?? BIRDS_CELL_CACHE_CAPACITY,
    });
    this.#cellSubdivisionCache = new QuickLRU({
      maxSize: options.cellSubdivisionCacheCapacity ?? BIRDS_CELL_SUBDIVISION_CACHE_CAPACITY,
    });
    this.#cellOutflowSubdivisionCache = new QuickLRU({
      maxSize: options.cellIncidenceCacheCapacity ?? BIRDS_CELL_INCIDENCE_CACHE_CAPACITY,
    });
    this.#cellInflowSubdivisionCache = new QuickLRU({
      maxSize: options.cellIncidenceCacheCapacity ?? BIRDS_CELL_INCIDENCE_CACHE_CAPACITY,
    });
    this.#flowSpaceSubdivisionCache = new QuickLRU({
      maxSize:
        options.flowReconciliationCacheCapacity ??
        BIRDS_FLOW_RECONCILIATION_CACHE_CAPACITY,
    });
    this.#cacheCapacity =
      2 *
      ((options.flowCacheCapacity ?? BIRDS_FLOW_CACHE_CAPACITY) +
        (options.temporalBatchCacheCapacity ?? BIRDS_TEMPORAL_BATCH_CACHE_CAPACITY) +
        (options.cellCacheCapacity ?? BIRDS_CELL_CACHE_CAPACITY) +
        (options.cellSubdivisionCacheCapacity ?? BIRDS_CELL_SUBDIVISION_CACHE_CAPACITY) +
        2 * (options.cellIncidenceCacheCapacity ?? BIRDS_CELL_INCIDENCE_CACHE_CAPACITY) +
        (options.flowReconciliationCacheCapacity ??
          BIRDS_FLOW_RECONCILIATION_CACHE_CAPACITY));
  }

  queryCell(cell: BirdCell): number {
    const stats = emptyStats();
    const count = this.#queryCell(cell, stats, 0);
    this.#recordStats(stats);
    return count;
  }

  queryFlow(flow: BirdFlow): number {
    const stats = emptyStats();
    const count = this.#queryFlow(flow, stats, 0);
    this.#recordStats(stats);
    return count;
  }

  queryTwoStageFlow(flow: BirdTwoStageFlow): number {
    const stats = emptyStats();
    const count = this.#queryTwoStageFlow(flow, stats, 0);
    this.#recordStats(stats);
    return count;
  }

  queryFlowTimeSubdivision(flow: BirdFlow): TemporalSubdivisionResult {
    if (classifyFlowTimeSubdivisionOwner(flow) === undefined) {
      throw new RangeError('Flow does not own a Birds temporal subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryFlowTimeSubdivision(flow, stats, 0);
    this.#recordStats(stats);
    return result;
  }

  queryCellSubdivision(cell: BirdCell): CellSubdivisionResult {
    if (classifyCellSubdivisionOwner(cell) === undefined) {
      throw new RangeError('Cell does not own a Birds spatial subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryCellSubdivision(cell, stats, 0);
    this.#recordStats(stats);
    return result;
  }

  queryCellOutflowSubdivision(cell: BirdCell): CellIncidenceSubdivisionResult {
    if (classifyCellOutflowSubdivisionOwner(cell) === undefined) {
      throw new RangeError('Cell does not own a Birds outflow subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryCellOutflowSubdivision(cell, stats, 0);
    this.#recordStats(stats);
    return result;
  }

  queryCellInflowSubdivision(cell: BirdCell): CellIncidenceSubdivisionResult {
    if (classifyCellInflowSubdivisionOwner(cell) === undefined) {
      throw new RangeError('Cell does not own a Birds inflow subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryCellInflowSubdivision(cell, stats, 0);
    this.#recordStats(stats);
    return result;
  }

  queryFlowSpaceSubdivision(flow: BirdFlow): FlowSpaceSubdivisionResult {
    if (classifyFlowSpaceSubdivisionOwner(flow) === undefined) {
      throw new RangeError('Flow does not own a Birds spatial subdivision');
    }
    const stats = emptyStats();
    const result = this.#queryFlowSpaceSubdivision(flow, stats, 0);
    this.#recordStats(stats);
    return result;
  }

  getLastQueryStats(): BirdsEngineStats {
    return this.#lastQueryStats;
  }

  getTotalQueryStats(): BirdsEngineStats {
    return this.#totalQueryStats;
  }

  #recordStats(stats: MutableStats): void {
    const next = publicStats(stats);
    this.#lastQueryStats = next;
    this.#totalQueryStats = addPublicStats(this.#totalQueryStats, next);
  }

  getCacheUsage(): {
    readonly capacity: number;
    readonly entries: number;
  } {
    return {
      capacity: this.#cacheCapacity,
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
    this.#visitDependency(stats, depth, { role: 'cell', cell });
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const construction = depth === 0 ? classifyCell(cell) : classifyCanonicalCell(cell);
    if (construction === undefined) throw new RangeError('Invalid Birds cell geometry');

    const keyStart = this.#cacheProfiler?.start();
    const key = cellKey(cell);
    if (keyStart !== undefined) this.#cacheProfiler!.recordKey('cell', keyStart);
    const getStart = this.#cacheProfiler?.start();
    const cached = this.#cellCache.get(key);
    if (getStart !== undefined) this.#cacheProfiler!.recordGet('cell', getStart, cached !== undefined);
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
        count = possibleCanonicalFlowDestinations(
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

    const setStart = this.#cacheProfiler?.start();
    this.#cellCache.set(key, count);
    if (setStart !== undefined) this.#cacheProfiler!.recordSet('cell', setStart);
    return count;
  }

  #queryFlow(flow: BirdFlow, stats: MutableStats, depth: number): number {
    this.#visitDependency(stats, depth, { role: 'flow', flow });
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const construction = depth === 0 ? classifyFlow(flow) : classifyCanonicalFlow(flow);
    if (construction === undefined) throw new RangeError('Invalid Birds flow geometry');
    if (!isPossibleCanonicalFlow(flow, this.#diffusionRate)) return 0;

    const keyStart = this.#cacheProfiler?.start();
    const key = flowKey(flow);
    if (keyStart !== undefined) this.#cacheProfiler!.recordKey('flow', keyStart);
    const getStart = this.#cacheProfiler?.start();
    const cached = this.#flowCache.get(key);
    if (getStart !== undefined) this.#cacheProfiler!.recordGet('flow', getStart, cached !== undefined);
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
        count = possibleCanonicalParentFlows(flow, this.#diffusionRate).reduce(
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

    const setStart = this.#cacheProfiler?.start();
    this.#flowCache.set(key, count);
    if (setStart !== undefined) this.#cacheProfiler!.recordSet('flow', setStart);
    return count;
  }

  #queryTwoStageFlow(
    flow: BirdTwoStageFlow,
    stats: MutableStats,
    depth: number,
  ): number {
    this.#visitDependency(stats, depth, { role: 'two-stage-flow', flow });
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const construction =
      depth === 0 ? classifyTwoStageFlow(flow) : classifyCanonicalTwoStageFlow(flow);
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
    this.#visitDependency(stats, depth, { role: 'temporal-subdivision', flow });
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyCanonicalFlowTimeSubdivisionOwner(flow);
    if (owner === undefined) {
      throw new RangeError('Flow does not own a Birds temporal subdivision');
    }

    const keyStart = this.#cacheProfiler?.start();
    const key = flowKey(flow);
    if (keyStart !== undefined) this.#cacheProfiler!.recordKey('temporal-batch', keyStart);
    const getStart = this.#cacheProfiler?.start();
    const cached = this.#temporalBatchCache.get(key);
    if (getStart !== undefined) {
      this.#cacheProfiler!.recordGet('temporal-batch', getStart, cached !== undefined);
    }
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.temporalBatchesEvaluated += 1;
    const parentCount = this.#queryFlow(flow, stats, depth + 1);
    const categories = canonicalMidpointCellProbabilities(flow, this.#diffusionRate);
    let counts: readonly number[] = [];
    if (categories.length > 0) {
      stats.samplerCalls += 1;
      counts = multinomial(
        this.#random,
        temporalBatchAddress(flow, owner.stage),
        parentCount,
        categories.map(({ cell, probability }) => ({
          probability,
          address: ['midpoint-cell', cell.min, cell.max, cell.time],
        })),
      );
    }
    const result: TemporalSubdivisionResult = {
      parentCount,
      entries: categories.map(({ cell }, index) => ({
        midpointCell: cell,
        count: counts[index],
      })),
    };
    const setStart = this.#cacheProfiler?.start();
    this.#temporalBatchCache.set(key, result);
    if (setStart !== undefined) this.#cacheProfiler!.recordSet('temporal-batch', setStart);
    return result;
  }

  #queryCellSubdivision(
    cell: BirdCell,
    stats: MutableStats,
    depth: number,
  ): CellSubdivisionResult {
    this.#visitDependency(stats, depth, { role: 'cell-subdivision', cell });
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyCanonicalCellSubdivisionOwner(cell);
    if (owner === undefined) {
      throw new RangeError('Cell does not own a Birds spatial subdivision');
    }

    const keyStart = this.#cacheProfiler?.start();
    const key = cellKey(cell);
    if (keyStart !== undefined) this.#cacheProfiler!.recordKey('cell-subdivision', keyStart);
    const getStart = this.#cacheProfiler?.start();
    const cached = this.#cellSubdivisionCache.get(key);
    if (getStart !== undefined) {
      this.#cacheProfiler!.recordGet('cell-subdivision', getStart, cached !== undefined);
    }
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.cellSubdivisionsEvaluated += 1;
    const parentCount = this.#queryCell(cell, stats, depth + 1);
    stats.samplerCalls += 1;
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
    const setStart = this.#cacheProfiler?.start();
    this.#cellSubdivisionCache.set(key, result);
    if (setStart !== undefined) this.#cacheProfiler!.recordSet('cell-subdivision', setStart);
    return result;
  }

  #queryCellOutflowSubdivision(
    cell: BirdCell,
    stats: MutableStats,
    depth: number,
  ): CellIncidenceSubdivisionResult {
    this.#visitDependency(stats, depth, { role: 'outflow-subdivision', cell });
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyCanonicalCellOutflowSubdivisionOwner(cell);
    if (owner === undefined) {
      throw new RangeError('Cell does not own a Birds outflow subdivision');
    }

    const keyStart = this.#cacheProfiler?.start();
    const key = cellKey(cell);
    if (keyStart !== undefined) this.#cacheProfiler!.recordKey('outflow-subdivision', keyStart);
    const getStart = this.#cacheProfiler?.start();
    const cached = this.#cellOutflowSubdivisionCache.get(key);
    if (getStart !== undefined) {
      this.#cacheProfiler!.recordGet('outflow-subdivision', getStart, cached !== undefined);
    }
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.incidenceBatchesEvaluated += 1;
    const parentFlows = possibleCanonicalFlowDestinations(
      cell,
      owner.flowDuration,
      this.#diffusionRate,
    )
      .filter((destination) => destination.max - destination.min === owner.destinationCellLength)
      .map((destination) => ({ source: cell, destination }));
    const capacities = parentFlows.map((flow) => this.#queryFlow(flow, stats, depth + 1));
    const subdivision = this.#queryCellSubdivision(cell, stats, depth + 1);
    stats.samplerCalls += 1;
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
    const setStart = this.#cacheProfiler?.start();
    this.#cellOutflowSubdivisionCache.set(key, result);
    if (setStart !== undefined) this.#cacheProfiler!.recordSet('outflow-subdivision', setStart);
    return result;
  }

  #queryCellInflowSubdivision(
    cell: BirdCell,
    stats: MutableStats,
    depth: number,
  ): CellIncidenceSubdivisionResult {
    this.#visitDependency(stats, depth, { role: 'inflow-subdivision', cell });
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyCanonicalCellInflowSubdivisionOwner(cell);
    if (owner === undefined) {
      throw new RangeError('Cell does not own a Birds inflow subdivision');
    }

    const keyStart = this.#cacheProfiler?.start();
    const key = cellKey(cell);
    if (keyStart !== undefined) this.#cacheProfiler!.recordKey('inflow-subdivision', keyStart);
    const getStart = this.#cacheProfiler?.start();
    const cached = this.#cellInflowSubdivisionCache.get(key);
    if (getStart !== undefined) {
      this.#cacheProfiler!.recordGet('inflow-subdivision', getStart, cached !== undefined);
    }
    if (cached !== undefined) {
      stats.cacheHits += 1;
      return cached;
    }

    stats.incidenceBatchesEvaluated += 1;
    const parentFlows = possibleCanonicalFlowSources(
      cell,
      owner.flowDuration,
      this.#diffusionRate,
    )
      .filter((source) => source.max - source.min === owner.sourceCellLength)
      .map((source) => ({ source, destination: cell }));
    const capacities = parentFlows.map((flow) => this.#queryFlow(flow, stats, depth + 1));
    const subdivision = this.#queryCellSubdivision(cell, stats, depth + 1);
    stats.samplerCalls += 1;
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
    const setStart = this.#cacheProfiler?.start();
    this.#cellInflowSubdivisionCache.set(key, result);
    if (setStart !== undefined) this.#cacheProfiler!.recordSet('inflow-subdivision', setStart);
    return result;
  }

  #queryFlowSpaceSubdivision(
    flow: BirdFlow,
    stats: MutableStats,
    depth: number,
  ): FlowSpaceSubdivisionResult {
    this.#visitDependency(stats, depth, { role: 'flow-space-subdivision', flow });
    stats.maximumDepth = Math.max(stats.maximumDepth, depth);
    const owner = classifyCanonicalFlowSpaceSubdivisionOwner(flow);
    if (owner === undefined) {
      throw new RangeError('Flow does not own a Birds spatial subdivision');
    }

    const keyStart = this.#cacheProfiler?.start();
    const key = flowKey(flow);
    if (keyStart !== undefined) {
      this.#cacheProfiler!.recordKey('flow-space-subdivision', keyStart);
    }
    const getStart = this.#cacheProfiler?.start();
    const cached = this.#flowSpaceSubdivisionCache.get(key);
    if (getStart !== undefined) {
      this.#cacheProfiler!.recordGet('flow-space-subdivision', getStart, cached !== undefined);
    }
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
    stats.samplerCalls += 1;
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
    const setStart = this.#cacheProfiler?.start();
    this.#flowSpaceSubdivisionCache.set(key, result);
    if (setStart !== undefined) {
      this.#cacheProfiler!.recordSet('flow-space-subdivision', setStart);
    }
    return result;
  }

  #visitDependency(stats: MutableStats, depth: number, node: BirdsDependencyNode): void {
    if (this.#observeDependency === undefined) return;
    if (depth > 0) {
      const dependent = stats.dependencyPath[depth - 1];
      if (dependent !== undefined) this.#observeDependency({ dependent, dependency: node });
    }
    stats.dependencyPath.length = depth;
    stats.dependencyPath[depth] = node;
  }
}

function flowKey(flow: BirdFlow): string {
  const { source, destination } = flow;
  return `${source.min}:${source.max}@${source.time}>${destination.min}:${destination.max}@${destination.time}`;
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
    samplerCalls: 0,
    temporalBatchesEvaluated: 0,
    twoStageEntriesEvaluated: 0,
    dependencyPath: [],
  };
}

function publicStats(stats: MutableStats): BirdsEngineStats {
  return {
    cacheHits: stats.cacheHits,
    cellsEvaluated: stats.cellsEvaluated,
    cellSubdivisionsEvaluated: stats.cellSubdivisionsEvaluated,
    incidenceBatchesEvaluated: stats.incidenceBatchesEvaluated,
    flowReconciliationsEvaluated: stats.flowReconciliationsEvaluated,
    flowsEvaluated: stats.flowsEvaluated,
    maximumDepth: stats.maximumDepth,
    samplerCalls: stats.samplerCalls,
    temporalBatchesEvaluated: stats.temporalBatchesEvaluated,
    twoStageEntriesEvaluated: stats.twoStageEntriesEvaluated,
  };
}

function addPublicStats(left: BirdsEngineStats, right: BirdsEngineStats): BirdsEngineStats {
  return {
    cacheHits: left.cacheHits + right.cacheHits,
    cellsEvaluated: left.cellsEvaluated + right.cellsEvaluated,
    cellSubdivisionsEvaluated:
      left.cellSubdivisionsEvaluated + right.cellSubdivisionsEvaluated,
    incidenceBatchesEvaluated:
      left.incidenceBatchesEvaluated + right.incidenceBatchesEvaluated,
    flowReconciliationsEvaluated:
      left.flowReconciliationsEvaluated + right.flowReconciliationsEvaluated,
    flowsEvaluated: left.flowsEvaluated + right.flowsEvaluated,
    maximumDepth: Math.max(left.maximumDepth, right.maximumDepth),
    samplerCalls: left.samplerCalls + right.samplerCalls,
    temporalBatchesEvaluated:
      left.temporalBatchesEvaluated + right.temporalBatchesEvaluated,
    twoStageEntriesEvaluated:
      left.twoStageEntriesEvaluated + right.twoStageEntriesEvaluated,
  };
}
