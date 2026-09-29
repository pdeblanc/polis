import { createBirds2aMotionSupport, isWithinBirds2MotionSupport } from '../birds2a/motionSupport';
import QuickLRU from 'quick-lru';
import { binomial } from '../../utils/distributions/binomial';
import { multinomial } from '../../utils/distributions/multinomial';
import { hypergeometric } from '../../utils/distributions/hypergeometric';
import { multivariateHypergeometric } from '../../utils/distributions/multivariateHypergeometric';
import { createAddressedRandom, type AddressedRandom, type Seed } from '../../utils/rng/addressedRandom';
import type { Address } from '../../utils/rng/address';
import { classifyCompositeCell, classifyCompositeCellSubdivision, classifyCompositeFlow,
  type CompositeCell, type CompositeFlow } from './compositeClassifiers';
import { classifyCompositeFlowSpaceSubdivision, classifyCompositeInflowSubdivision,
  classifyCompositeOutflowSubdivision } from './compositeOwnerClassifiers';
import { compositeMidpointCellProbabilities,
  possibleCompositeFlowDestinations, possibleCompositeFlowSources, possibleCompositeParentFlows } from './compositeMotionSupport';

export const BIRDS_COMPOSITE_FACT_CACHE_CAPACITY = 50_000;
export const BIRDS_COMPOSITE_BATCH_CACHE_CAPACITY = 20_000;
type Pair = readonly [number, number];

/** No mutation or cache-management methods cross the stochastic layer boundary. */
export interface CompositeBoundaryReader {
  queryCell(cell: CompositeCell): number;
  queryFlow(flow: CompositeFlow): number;
}
export type CompositeDependencyNode =
  | { readonly role: 'cell' | 'cell-subdivision' | 'outflow-subdivision' | 'inflow-subdivision'; readonly cell: CompositeCell }
  | { readonly role: 'flow' | 'temporal-subdivision' | 'flow-space-subdivision'; readonly flow: CompositeFlow };
export interface CompositeDependencyEdge {
  readonly dependent: CompositeDependencyNode;
  readonly dependency: CompositeDependencyNode;
}

/** Aggregate-only refinement. Its lower layer is a read-only boundary provider.
 * It neither owns expansions nor changes channel stochastic facts. */
export class CompositeEngine {
  readonly #source: CompositeBoundaryReader;
  readonly motionSupport: ReturnType<typeof createBirds2aMotionSupport>;
  readonly #random: AddressedRandom;
  readonly #prefix: Address;
  readonly #observeDependency?: (edge: CompositeDependencyEdge) => void;
  #activeDependency?: CompositeDependencyNode;
  readonly #cells = new QuickLRU<string, number>({ maxSize: BIRDS_COMPOSITE_FACT_CACHE_CAPACITY });
  readonly #flows = new QuickLRU<string, number>({ maxSize: BIRDS_COMPOSITE_FACT_CACHE_CAPACITY });
  readonly #temporal = new QuickLRU<string, ReadonlyMap<number, number>>({ maxSize: BIRDS_COMPOSITE_BATCH_CACHE_CAPACITY });
  readonly #splits = new QuickLRU<string, Pair>({ maxSize: BIRDS_COMPOSITE_BATCH_CACHE_CAPACITY });
  readonly #incidence = new QuickLRU<string, ReadonlyMap<number, Pair>>({ maxSize: BIRDS_COMPOSITE_BATCH_CACHE_CAPACITY });
  readonly #spatial = new QuickLRU<string, readonly number[]>({ maxSize: BIRDS_COMPOSITE_BATCH_CACHE_CAPACITY });

  constructor(seed: Seed, diffusionRate: number, source: CompositeBoundaryReader,
    observeDependency?: (edge: CompositeDependencyEdge) => void) {
    this.#source = source;
    this.motionSupport = createBirds2aMotionSupport(diffusionRate);
    this.#random = createAddressedRandom(seed);
    this.#prefix = ['birds2b.composite'];
    this.#observeDependency = observeDependency;
  }

  /** Clears only this layer's disposable caches; the boundary provider is untouched. */
  clearCache(): void {
    this.#cells.clear(); this.#flows.clear(); this.#temporal.clear();
    this.#splits.clear(); this.#incidence.clear(); this.#spatial.clear();
  }

  getCacheUsage(): { readonly entries: number; readonly capacity: number } {
    return { entries: this.#cells.size + this.#flows.size + this.#temporal.size + this.#splits.size + this.#incidence.size + this.#spatial.size,
      capacity: 2 * BIRDS_COMPOSITE_FACT_CACHE_CAPACITY + 4 * BIRDS_COMPOSITE_BATCH_CACHE_CAPACITY };
  }

  queryCell(cell: CompositeCell): number {
    return this.#cached(this.#cells, cellKey(cell), this.#observeDependency && { role: 'cell', cell }, () => {
      // Cache entries are already validated; classify only misses.
      const construction = classifyCompositeCell(cell);
      if (!construction) throw new RangeError('Invalid composite cell');
      switch (construction.kind) {
        case 'channel-merge': return this.#source.queryCell(cell);
        case 'spatial-child': return this.#subdivideCell(construction.subdivisionOwner)[construction.childIndex];
        case 'temporal-aggregation': return possibleCompositeFlowDestinations(
          cell, construction.outgoingDuration, this.motionSupport,
        ).filter((other) => width(other) === width(cell))
          .reduce((sum, destination) => sum + this.queryFlow({ source: cell, destination }), 0);
      }
    });
  }

  /** Read-only lookup: never evaluates a dependency in either layer. */
  queryCachedCell(cell: CompositeCell): number | undefined {
    const previous = this.#cells.peek(cellKey(cell));
    if (previous !== undefined) return previous;
    if (!classifyCompositeCell(cell)) throw new RangeError('Invalid composite cell');
    return undefined;
  }

  queryCellSubdivision(cell: CompositeCell) {
    const subdivision = classifyCompositeCellSubdivision(cell);
    if (!subdivision) throw new RangeError('Invalid composite cell');
    const [left, right] = subdivision.children;
    return {
      parentCount: this.queryCell(cell),
      children: [
        { cell: left, count: this.queryCell(left) },
        { cell: right, count: this.queryCell(right) },
      ] as const,
    };
  }

  queryFlow(flow: CompositeFlow): number {
    return this.#cached(this.#flows, flowKey(flow), this.#observeDependency && { role: 'flow', flow }, () => {
      const construction = classifyCompositeFlow(flow);
      if (!construction) throw new RangeError('Invalid composite flow');
      if (!isWithinBirds2MotionSupport(flow, this.motionSupport)) return 0;
      switch (construction.kind) {
        case 'channel-merge': return this.#source.queryFlow(flow);
        case 'temporal-aggregation': {
          const midpoint = construction.leg === 'first' ? flow.destination : flow.source;
          return possibleCompositeParentFlows(flow, this.motionSupport)
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

  #subdivideTime(flow: CompositeFlow): ReadonlyMap<number, number> {
    return this.#cached(this.#temporal, flowKey(flow), this.#observeDependency && { role: 'temporal-subdivision', flow }, () => {
      // A merge-owned joint must never be independently resampled.
      const categories = compositeMidpointCellProbabilities(flow, this.motionSupport);
      const count = this.queryFlow(flow);
      if (!count) return new Map();
      const counts = multinomial(this.#random, [...this.#prefix, 'temporal', ...flowAddress(flow)], count,
        categories.map(({ cell, probability }) => ({ probability, address: cellAddress(cell) })));
      return new Map(categories.map(({ cell }, index) => [cell.min, counts[index]]));
    });
  }

  #subdivideCell(cell: CompositeCell): Pair {
    return this.#cached(this.#splits, cellKey(cell), this.#observeDependency && { role: 'cell-subdivision', cell }, () => {
      const owner = classifyCompositeCellSubdivision(cell)!;
      if (owner.kind === 'channel-merge') return [
        this.#source.queryCell(owner.children[0]),
        this.#source.queryCell(owner.children[1]),
      ];
      const count = this.queryCell(cell);
      const left = binomial(this.#random, [...this.#prefix, 'cell', ...cellAddress(cell)], count, owner.probability);
      return [left, count - left];
    });
  }

  #subdivideIncidence(cell: CompositeCell, outgoing: boolean): ReadonlyMap<number, Pair> {
    const role = outgoing ? 'outflows' : 'inflows';
    return this.#cached(this.#incidence, `${role}:${cellKey(cell)}`,
      this.#observeDependency && { role: outgoing ? 'outflow-subdivision' : 'inflow-subdivision', cell }, () => {
      const owner = (outgoing ? classifyCompositeOutflowSubdivision : classifyCompositeInflowSubdivision)(cell)!;
      if (this.queryCell(cell) === 0) return new Map();
      const endpoints = (outgoing ? possibleCompositeFlowDestinations : possibleCompositeFlowSources)(
        cell, owner.flowDuration, this.motionSupport,
      ).filter((other) => width(other) === owner.oppositeCellWidth);
      const makeFlow = (local: CompositeCell, other: CompositeCell): CompositeFlow => outgoing
        ? { source: local, destination: other } : { source: other, destination: local };
      if (owner.kind === 'channel-merge') return new Map(endpoints.map((other) => [other.min,
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

  #subdivideSpace(flow: CompositeFlow): readonly number[] {
    return this.#cached(this.#spatial, flowKey(flow), this.#observeDependency && { role: 'flow-space-subdivision', flow }, () => {
      const owner = classifyCompositeFlowSpaceSubdivision(flow)!;
      if (owner.kind === 'channel-merge') return owner.childFlows.map((child) => this.queryFlow(child));
      const count = this.queryFlow(flow);
      if (!count) return [0, 0, 0, 0];
      const row = this.queryFlow(owner.sourceMargins[0]), column = this.queryFlow(owner.destinationMargins[0]);
      const upperLeft = hypergeometric(this.#random, [...this.#prefix, 'space', ...flowAddress(flow)], count, row, column);
      return [upperLeft, row - upperLeft, column - upperLeft, count - row - column + upperLeft];
    });
  }

  #cached<T>(cache: QuickLRU<string, T>, key: string, node: CompositeDependencyNode | undefined, compute: () => T): T {
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
function width(cell: CompositeCell): number { return cell.max - cell.min; }
function cellKey(cell: CompositeCell): string { return `${cell.min}:${cell.max}:${cell.time}`; }
function flowKey(flow: CompositeFlow): string { return `${cellKey(flow.source)}:${cellKey(flow.destination)}`; }
function cellAddress(cell: CompositeCell): Address { return [cell.min, cell.max, cell.time]; }
function flowAddress(flow: CompositeFlow): Address { return [...cellAddress(flow.source), ...cellAddress(flow.destination)]; }
