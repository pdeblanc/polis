import QuickLRU from 'quick-lru';
import { binomial } from '../../utils/distributions/binomial';
import { multinomial } from '../../utils/distributions/multinomial';
import { hypergeometric } from '../../utils/distributions/hypergeometric';
import { multivariateHypergeometric } from '../../utils/distributions/multivariateHypergeometric';
import { createAddressedRandom, type AddressedRandom, type Seed } from '../../utils/rng/addressedRandom';
import type { Address } from '../../utils/rng/address';
import type { Birds2aDependencyEdge, Birds2aDependencyNode } from './dependencyRanks';
import { Birds2aExpansion, type ExpansionCell } from './expansion';
import { classifyBirds2aCell, classifyBirds2aCellGeometry, classifyBirds2aCellSubdivision, classifyBirds2aFlow,
  type Birds2aCell, type Birds2aFlow } from './classifiers';
import { classifyBirds2aFlowTimeSubdivision, classifyBirds2aFlowSpaceSubdivision, classifyBirds2aInflowSubdivision,
  classifyBirds2aOutflowSubdivision } from './ownerClassifiers';
import { readExpansionCell, readExpansionFlow } from './expansionFacts';
import { createBirds2aMotionSupport, isWithinBirds2MotionSupport, birds2aMidpointCellProbabilities,
  possibleBirds2aFlowDestinations, possibleBirds2aFlowSources, possibleBirds2aParentFlows } from './motionSupport';

export const BIRDS_2A_FACT_CACHE_CAPACITY = 50_000;
export const BIRDS_2A_BATCH_CACHE_CAPACITY = 20_000;
type Pair = readonly [number, number];

/** Internal single-origin hierarchy: synchronous expansion plus A–H contraction.
 * No global summation, public resolution wrapper, or materialized trajectories. */
export class Birds2aEngine {
  readonly expansion: Birds2aExpansion;
  readonly motionSupport: ReturnType<typeof createBirds2aMotionSupport>;
  readonly #random: AddressedRandom;
  readonly #prefix: Address;
  readonly #observeDependency?: (edge: Birds2aDependencyEdge) => void;
  #activeDependency?: Birds2aDependencyNode;
  readonly #cells = new QuickLRU<string, number>({ maxSize: BIRDS_2A_FACT_CACHE_CAPACITY });
  readonly #flows = new QuickLRU<string, number>({ maxSize: BIRDS_2A_FACT_CACHE_CAPACITY });
  readonly #temporal = new QuickLRU<string, ReadonlyMap<number, number>>({ maxSize: BIRDS_2A_BATCH_CACHE_CAPACITY });
  readonly #splits = new QuickLRU<string, Pair>({ maxSize: BIRDS_2A_BATCH_CACHE_CAPACITY });
  readonly #incidence = new QuickLRU<string, ReadonlyMap<number, Pair>>({ maxSize: BIRDS_2A_BATCH_CACHE_CAPACITY });
  readonly #spatial = new QuickLRU<string, readonly number[]>({ maxSize: BIRDS_2A_BATCH_CACHE_CAPACITY });

  constructor(seed: Seed, populationDensity: number, diffusionRate: number, origin?: ExpansionCell,
    observeDependency?: (edge: Birds2aDependencyEdge) => void) {
    this.expansion = new Birds2aExpansion(seed, populationDensity, diffusionRate, origin);
    this.motionSupport = createBirds2aMotionSupport(diffusionRate);
    this.#random = createAddressedRandom(seed);
    this.#prefix = ['birds2a.refinement', this.expansion.origin.min, this.expansion.origin.max];
    this.#observeDependency = observeDependency;
  }

  /** Clears disposable contraction caches; authoritative expansion batches remain. */
  clearCache(): void {
    this.#cells.clear(); this.#flows.clear(); this.#temporal.clear();
    this.#splits.clear(); this.#incidence.clear(); this.#spatial.clear();
  }

  getCacheUsage(): { readonly entries: number; readonly capacity: number } {
    return { entries: this.#cells.size + this.#flows.size + this.#temporal.size + this.#splits.size + this.#incidence.size + this.#spatial.size,
      capacity: 2 * BIRDS_2A_FACT_CACHE_CAPACITY + 4 * BIRDS_2A_BATCH_CACHE_CAPACITY };
  }

  queryCell(cell: Birds2aCell): number {
    return this.#cached(this.#cells, cellKey(cell), this.#observeDependency && { role: 'cell', cell }, () => {
      // Cache entries are already validated; classify only misses.
      const construction = classifyBirds2aCell(cell, this.expansion.origin);
      if (!construction) throw new RangeError('Invalid Birds 2a cell');
      if (this.expansion.getEpoch(0).population === 0) return 0;
      switch (construction.kind) {
        case 'expansion': return readExpansionCell(this.expansion, cell, construction.projection);
        case 'spatial-child': return this.#subdivideCell(construction.subdivisionOwner)[construction.childIndex];
        case 'temporal-aggregation': return possibleBirds2aFlowDestinations(
          cell, construction.outgoingDuration, this.expansion.origin, this.motionSupport, width(cell),
        )
          .reduce((sum, destination) => sum + this.queryFlow({ source: cell, destination }), 0);
      }
    });
  }

  /** Read-only lookup: never expands the channel or evaluates a dependency. */
  queryCachedCell(cell: Birds2aCell): number | undefined {
    const previous = this.#cells.peek(cellKey(cell));
    if (previous !== undefined) return previous;
    if (!classifyBirds2aCell(cell, this.expansion.origin)) throw new RangeError('Invalid Birds 2a cell');
    return undefined;
  }

  queryCellSubdivision(cell: Birds2aCell) {
    const subdivision = classifyBirds2aCellSubdivision(cell, this.expansion.origin);
    if (!subdivision) throw new RangeError('Invalid Birds 2a cell');
    const [left, right] = subdivision.children;
    return {
      parentCount: this.queryCell(cell),
      children: [
        { cell: left, count: this.queryCell(left) },
        { cell: right, count: this.queryCell(right) },
      ] as const,
    };
  }

  queryFlow(flow: Birds2aFlow): number {
    return this.#cached(this.#flows, flowKey(flow), this.#observeDependency && { role: 'flow', flow }, () => {
      const construction = classifyBirds2aFlow(flow, this.expansion.origin);
      if (!construction) throw new RangeError('Invalid Birds 2a flow');
      if (this.expansion.getEpoch(0).population === 0) return 0;
      if (!isWithinBirds2MotionSupport(flow, this.motionSupport)) return 0;
      switch (construction.kind) {
        case 'expansion': return readExpansionFlow(this.expansion, construction.projection);
        case 'temporal-aggregation': {
          const midpoint = construction.leg === 'first' ? flow.destination : flow.source;
          return possibleBirds2aParentFlows(flow, this.expansion.origin, this.motionSupport)
            .reduce((sum, parent) => sum + (this.#subdivideTime(parent).get(midpoint.min) ?? 0), 0);
        }
        case 'source-subdivision': return this.#subdivideIncidence(construction.subdivisionOwner, true)
          .get(flow.destination.min)?.[construction.childIndex] ?? 0;
        case 'destination-subdivision': return this.#subdivideIncidence(construction.subdivisionOwner, false)
          .get(flow.source.min)?.[construction.childIndex] ?? 0;
        case 'spatial-reconciliation': {
          const counts = this.#subdivideSpace(construction.subdivisionOwner);
          return counts[2 * construction.sourceChildIndex + construction.destinationChildIndex];
        }
      }
    });
  }

  /** Internal three-time fact for calibration; not part of the consumer API.
   * Uses exactly the A/C allocation used by ordinary leg queries. */
  queryTemporalSplit(flow: Birds2aFlow, midpoint: Birds2aCell): number {
    const owner = classifyBirds2aFlowTimeSubdivision(flow, this.expansion.origin);
    if (!owner || !classifyBirds2aCellGeometry(midpoint) ||
      midpoint.time !== owner.midpointTime || width(midpoint) !== owner.midpointCellWidth) {
      throw new RangeError('Invalid Birds 2a temporal split');
    }
    return this.#subdivideTime(flow).get(midpoint.min) ?? 0;
  }

  #subdivideTime(flow: Birds2aFlow): ReadonlyMap<number, number> {
    return this.#cached(this.#temporal, flowKey(flow), this.#observeDependency && { role: 'temporal-subdivision', flow }, () => {
      // Checks ownership even for zero counts: an expansion-owned joint must
      // never be silently replaced by a contraction draw.
      const categories = birds2aMidpointCellProbabilities(flow, this.expansion.origin, this.motionSupport);
      const count = this.queryFlow(flow);
      if (!count) return new Map();
      const counts = multinomial(this.#random, [...this.#prefix, 'temporal', ...flowAddress(flow)], count,
        categories.map(({ cell, probability }) => ({ probability, address: cellAddress(cell) })));
      return new Map(categories.map(({ cell }, index) => [cell.min, counts[index]]));
    });
  }

  #subdivideCell(cell: Birds2aCell): Pair {
    return this.#cached(this.#splits, cellKey(cell), this.#observeDependency && { role: 'cell-subdivision', cell }, () => {
      const owner = classifyBirds2aCellSubdivision(cell, this.expansion.origin)!;
      if (owner.kind === 'expansion') return [
        readExpansionCell(this.expansion, owner.children[0], owner.projection),
        readExpansionCell(this.expansion, owner.children[1], owner.projection),
      ];
      const count = this.queryCell(cell);
      const left = binomial(this.#random, [...this.#prefix, 'cell', ...cellAddress(cell)], count, owner.probability);
      return [left, count - left];
    });
  }

  #subdivideIncidence(cell: Birds2aCell, outgoing: boolean): ReadonlyMap<number, Pair> {
    const role = outgoing ? 'outflows' : 'inflows';
    return this.#cached(this.#incidence, `${role}:${cellKey(cell)}`,
      this.#observeDependency && { role: outgoing ? 'outflow-subdivision' : 'inflow-subdivision', cell }, () => {
      const owner = (outgoing ? classifyBirds2aOutflowSubdivision : classifyBirds2aInflowSubdivision)(cell, this.expansion.origin)!;
      if (this.queryCell(cell) === 0) return new Map();
      const endpoints = (outgoing ? possibleBirds2aFlowDestinations : possibleBirds2aFlowSources)(
        cell, owner.flowDuration, this.expansion.origin, this.motionSupport, owner.oppositeCellWidth,
      );
      const makeFlow = (local: Birds2aCell, other: Birds2aCell): Birds2aFlow => outgoing
        ? { source: local, destination: other } : { source: other, destination: local };
      if (owner.kind === 'expansion') return new Map(endpoints.map((other) => [other.min,
        [this.queryFlow(makeFlow(owner.children[0], other)), this.queryFlow(makeFlow(owner.children[1], other))] as Pair]));
      const counts = endpoints.map((other) => this.queryFlow(makeFlow(cell, other)));
      const [left] = this.#subdivideCell(cell);
      if (!counts.some(Boolean)) {
        if (left !== 0) throw new Error('Nonzero child population without incident capacity');
        return new Map();
      }
      const allocated = multivariateHypergeometric(this.#random,
        [...this.#prefix, role, ...cellAddress(cell)],
        endpoints.map((other, index) => ({ capacity: counts[index], address: cellAddress(other) })), left);
      return new Map(endpoints.map((other, index) => [other.min, [allocated[index], counts[index] - allocated[index]] as Pair]));
    });
  }

  #subdivideSpace(flow: Birds2aFlow): readonly number[] {
    return this.#cached(this.#spatial, flowKey(flow), this.#observeDependency && { role: 'flow-space-subdivision', flow }, () => {
      const owner = classifyBirds2aFlowSpaceSubdivision(flow, this.expansion.origin)!;
      if (owner.kind === 'expansion') return owner.childFlows.map((child) => this.queryFlow(child));
      const count = this.queryFlow(flow);
      if (!count) return [0, 0, 0, 0];
      const row = this.queryFlow(owner.sourceMargins[0]), column = this.queryFlow(owner.destinationMargins[0]);
      const upperLeft = hypergeometric(this.#random, [...this.#prefix, 'space', ...flowAddress(flow)], count, row, column);
      return [upperLeft, row - upperLeft, column - upperLeft, count - row - column + upperLeft];
    });
  }

  #cached<T>(cache: QuickLRU<string, T>, key: string, node: Birds2aDependencyNode | undefined, compute: () => T): T {
    if (!node) return cached(cache, key, compute);
    const dependent = this.#activeDependency;
    if (dependent) this.#observeDependency!({ dependent, dependency: node });
    this.#activeDependency = node;
    try { return cached(cache, key, compute); }
    finally { this.#activeDependency = dependent; }
  }
}

function cached<T>(cache: QuickLRU<string, T>, key: string, compute: () => T): T {
  const previous = cache.get(key);
  if (previous !== undefined) return previous;
  const result = compute(); cache.set(key, result); return result;
}
function width(cell: Birds2aCell): number { return cell.max - cell.min; }
function cellKey(cell: Birds2aCell): string { return `${cell.min}:${cell.max}:${cell.time}`; }
function flowKey({ source: s, destination: d }: Birds2aFlow): string {
  return [s.min, s.max, s.time, d.min, d.max, d.time].join(':');
}
function cellAddress(cell: Birds2aCell): Address { return [cell.min, cell.max, cell.time]; }
function flowAddress(flow: Birds2aFlow): Address { return [...cellAddress(flow.source), ...cellAddress(flow.destination)]; }
