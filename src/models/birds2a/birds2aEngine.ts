import QuickLRU from 'quick-lru';
import { binomial } from '../../utils/distributions/binomial';
import { multinomial } from '../../utils/distributions/multinomial';
import { hypergeometric } from '../../utils/distributions/hypergeometric';
import { multivariateHypergeometric } from '../../utils/distributions/multivariateHypergeometric';
import { createAddressedRandom, type AddressedRandom, type Seed } from '../../utils/rng/addressedRandom';
import type { Address } from '../../utils/rng/address';
import { Birds2aExpansion, type ExpansionCell } from './expansion';
import { classifyBirds2aCell, classifyBirds2aCellSubdivision, classifyBirds2aFlow,
  type Birds2aCell, type Birds2aFlow } from './classifiers';
import { classifyBirds2aFlowSpaceSubdivision, classifyBirds2aInflowSubdivision,
  classifyBirds2aOutflowSubdivision } from './ownerClassifiers';
import { readExpansionCell, readExpansionFlow } from './expansionFacts';
import { createBirds2aMotionSupport, isPossibleBirds2aFlow, birds2aMidpointCellProbabilities,
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
  readonly #cells = new QuickLRU<string, number>({ maxSize: BIRDS_2A_FACT_CACHE_CAPACITY });
  readonly #flows = new QuickLRU<string, number>({ maxSize: BIRDS_2A_FACT_CACHE_CAPACITY });
  readonly #temporal = new QuickLRU<string, ReadonlyMap<number, number>>({ maxSize: BIRDS_2A_BATCH_CACHE_CAPACITY });
  readonly #splits = new QuickLRU<string, Pair>({ maxSize: BIRDS_2A_BATCH_CACHE_CAPACITY });
  readonly #incidence = new QuickLRU<string, ReadonlyMap<number, Pair>>({ maxSize: BIRDS_2A_BATCH_CACHE_CAPACITY });
  readonly #spatial = new QuickLRU<string, readonly number[]>({ maxSize: BIRDS_2A_BATCH_CACHE_CAPACITY });

  constructor(seed: Seed, populationDensity: number, diffusionRate: number, origin?: ExpansionCell) {
    this.expansion = new Birds2aExpansion(seed, populationDensity, diffusionRate, origin);
    this.motionSupport = createBirds2aMotionSupport(diffusionRate);
    this.#random = createAddressedRandom(seed);
    this.#prefix = ['birds2a.refinement', this.expansion.origin.min, this.expansion.origin.max];
  }

  /** Clears disposable contraction caches; authoritative expansion batches remain. */
  clearCache(): void {
    this.#cells.clear(); this.#flows.clear(); this.#temporal.clear();
    this.#splits.clear(); this.#incidence.clear(); this.#spatial.clear();
  }

  queryCell(cell: Birds2aCell): number {
    const construction = classifyBirds2aCell(cell, this.expansion.origin);
    if (!construction) throw new RangeError('Invalid Birds 2a cell');
    if (this.expansion.getEpoch(0).population === 0) return 0;
    return cached(this.#cells, cellKey(cell), () => {
      switch (construction.kind) {
        case 'expansion': return readExpansionCell(this.expansion, cell, construction.projection);
        case 'spatial-child': return this.#subdivideCell(construction.subdivisionOwner)[construction.childIndex];
        case 'temporal-aggregation': return possibleBirds2aFlowDestinations(
          cell, construction.outgoingDuration, this.expansion.origin, this.motionSupport,
        ).filter((other) => width(other) === width(cell))
          .reduce((sum, destination) => sum + this.queryFlow({ source: cell, destination }), 0);
      }
    });
  }

  queryFlow(flow: Birds2aFlow): number {
    const construction = classifyBirds2aFlow(flow, this.expansion.origin);
    if (!construction) throw new RangeError('Invalid Birds 2a flow');
    if (this.expansion.getEpoch(0).population === 0) return 0;
    return cached(this.#flows, flowKey(flow), () => {
      if (!isPossibleBirds2aFlow(flow, this.expansion.origin, this.motionSupport)) return 0;
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

  #subdivideTime(flow: Birds2aFlow): ReadonlyMap<number, number> {
    return cached(this.#temporal, flowKey(flow), () => {
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
    return cached(this.#splits, cellKey(cell), () => {
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
    return cached(this.#incidence, `${role}:${cellKey(cell)}`, () => {
      const owner = (outgoing ? classifyBirds2aOutflowSubdivision : classifyBirds2aInflowSubdivision)(cell, this.expansion.origin)!;
      if (this.queryCell(cell) === 0) return new Map();
      const endpoints = (outgoing ? possibleBirds2aFlowDestinations : possibleBirds2aFlowSources)(
        cell, owner.flowDuration, this.expansion.origin, this.motionSupport,
      ).filter((other) => width(other) === owner.oppositeCellWidth);
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
    return cached(this.#spatial, flowKey(flow), () => {
      const owner = classifyBirds2aFlowSpaceSubdivision(flow, this.expansion.origin)!;
      if (owner.kind === 'expansion') return owner.childFlows.map((child) => this.queryFlow(child));
      const count = this.queryFlow(flow);
      if (!count) return [0, 0, 0, 0];
      const row = this.queryFlow(owner.sourceMargins[0]), column = this.queryFlow(owner.destinationMargins[0]);
      const upperLeft = hypergeometric(this.#random, [...this.#prefix, 'space', ...flowAddress(flow)], count, row, column);
      return [upperLeft, row - upperLeft, column - upperLeft, count - row - column + upperLeft];
    });
  }
}

function cached<T>(cache: QuickLRU<string, T>, key: string, compute: () => T): T {
  const previous = cache.get(key);
  if (previous !== undefined) return previous;
  const result = compute(); cache.set(key, result); return result;
}
function width(cell: Birds2aCell): number { return cell.max - cell.min; }
function cellKey(cell: Birds2aCell): string { return `${cell.min}:${cell.max}:${cell.time}`; }
function flowKey(flow: Birds2aFlow): string { return `${cellKey(flow.source)}:${cellKey(flow.destination)}`; }
function cellAddress(cell: Birds2aCell): Address { return [cell.min, cell.max, cell.time]; }
function flowAddress(flow: Birds2aFlow): Address { return [...cellAddress(flow.source), ...cellAddress(flow.destination)]; }
