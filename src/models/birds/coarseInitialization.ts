import type { ProbabilityMassTable } from '../../utils/distributions/roundedNormal';
import { roundedNormal } from '../../utils/distributions/roundedNormal';
import { BIRDS_COARSE_CELL_LENGTH } from './scales';

export interface CoarseFlowAllocation {
  readonly offset: number;
  readonly targetProbability: number;
  readonly count: number;
}

export interface BirdsCoarseInitialization {
  readonly requestedPopulationDensity: number;
  readonly effectivePopulationDensity: number;
  readonly diffusionRate: number;
  readonly cellPopulation: number;
  readonly flows: readonly CoarseFlowAllocation[];
}

/** Converts world-space population density to the deterministic coarse-cell count. */
export function coarseCellPopulation(populationDensity: number): number {
  if (!Number.isFinite(populationDensity) || populationDensity < 0) {
    throw new RangeError('Population density must be a finite nonnegative number');
  }
  return Math.round(populationDensity * BIRDS_COARSE_CELL_LENGTH);
}

/** Constructs the translation-independent deterministic initialization kernel. */
export function createBirdsCoarseInitialization(
  populationDensity: number,
  diffusionRate: number,
): BirdsCoarseInitialization {
  if (!Number.isFinite(diffusionRate) || diffusionRate < 0) {
    throw new RangeError('Diffusion rate must be a finite nonnegative number');
  }

  const cellPopulation = coarseCellPopulation(populationDensity);
  const targetTable = roundedNormal(0, Math.sqrt(1 / 12 + diffusionRate));
  return {
    requestedPopulationDensity: populationDensity,
    effectivePopulationDensity: cellPopulation / BIRDS_COARSE_CELL_LENGTH,
    diffusionRate,
    cellPopulation,
    flows: symmetricIntegerAllocation(cellPopulation, targetTable),
  };
}

/** Returns the deterministic coarse-flow count for one destination offset. */
export function coarseFlowCount(
  initialization: BirdsCoarseInitialization,
  destinationOffset: number,
): number {
  if (!Number.isSafeInteger(destinationOffset)) return 0;
  return initialization.flows.find(({ offset }) => offset === destinationOffset)?.count ?? 0;
}

/**
 * Finds the reflection-symmetric integer vector minimizing L1 error from a probability
 * table. Among equal optima it returns the lexicographically smallest
 * `(n_0, n_1, n_2, ...)` vector.
 */
export function symmetricIntegerAllocation(
  population: number,
  targetTable: ProbabilityMassTable,
): readonly CoarseFlowAllocation[] {
  if (!Number.isSafeInteger(population) || population < 0) {
    throw new RangeError('Population must be a nonnegative safe integer');
  }
  if (targetTable.length === 0) {
    throw new RangeError('Coarse flow probability table must not be empty');
  }

  const probabilities = new Map<number, number>();
  let probabilityTotal = 0;
  for (const { value, probability } of targetTable) {
    if (
      !Number.isSafeInteger(value) ||
      !Number.isFinite(probability) ||
      probability < 0
    ) {
      throw new RangeError('Coarse flow probabilities require integer offsets and nonnegative mass');
    }
    probabilities.set(value, (probabilities.get(value) ?? 0) + probability);
    probabilityTotal += probability;
  }
  if (!(probabilityTotal > 0)) {
    throw new RangeError('Coarse flow probabilities must have positive total mass');
  }

  for (const [offset, probability] of probabilities) {
    probabilities.set(offset, probability / probabilityTotal);
  }

  const positiveOffsets = [...new Set([...probabilities.keys()].map(Math.abs))]
    .filter((offset) => offset > 0)
    .sort((left, right) => left - right);
  const pairTargets = positiveOffsets.map((offset) => {
    return {
      negative: population * (probabilities.get(-offset) ?? 0),
      positive: population * (probabilities.get(offset) ?? 0),
    };
  });
  const centerTarget = population * (probabilities.get(0) ?? 0);
  if (pairTargets.length === 0) {
    return [{ offset: 0, targetProbability: probabilities.get(0) ?? 0, count: population }];
  }
  const maximumPairUnits = Math.floor(population / 2);

  let low = 0;
  let high = maximumPairUnits;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const current = allocationObjective(population, middle, centerTarget, pairTargets);
    const next = allocationObjective(population, middle + 1, centerTarget, pairTargets);
    const tolerance =
      8 *
      Number.EPSILON *
      Math.max(1, Math.abs(current), Math.abs(next)) *
      (pairTargets.length + 1);
    if (next <= current + tolerance) low = middle + 1;
    else high = middle;
  }

  const pairCounts = allocatePairUnits(low, pairTargets);
  const centerCount = population - 2 * low;
  const result: CoarseFlowAllocation[] = [
    {
      offset: 0,
      targetProbability: probabilities.get(0) ?? 0,
      count: centerCount,
    },
  ];
  for (let index = 0; index < positiveOffsets.length; index += 1) {
    const offset = positiveOffsets[index];
    const count = pairCounts[index];
    result.push({
      offset: -offset,
      targetProbability: probabilities.get(-offset) ?? 0,
      count,
    });
    result.push({
      offset,
      targetProbability: probabilities.get(offset) ?? 0,
      count,
    });
  }
  return result.sort((left, right) => left.offset - right.offset);
}

interface PairTarget {
  readonly negative: number;
  readonly positive: number;
}

interface MarginalSegment {
  readonly cost: number;
  readonly count: number;
}

function allocationObjective(
  population: number,
  pairUnits: number,
  centerTarget: number,
  pairTargets: readonly PairTarget[],
): number {
  const centerCount = population - 2 * pairUnits;
  const pairCounts = allocatePairUnits(pairUnits, pairTargets);
  return (
    Math.abs(centerCount - centerTarget) +
    pairCounts.reduce(
      (sum, count, index) =>
        sum +
        Math.abs(count - pairTargets[index].negative) +
        Math.abs(count - pairTargets[index].positive),
      0,
    )
  );
}

/** Allocates pair units by increasing convex marginal cost and reverse-index tie-break. */
function allocatePairUnits(
  pairUnits: number,
  pairTargets: readonly PairTarget[],
): readonly number[] {
  if (pairTargets.length === 0) {
    if (pairUnits !== 0) throw new RangeError('A symmetric allocation needs an offset pair');
    return [];
  }

  const segments = pairTargets.map(marginalSegments);
  const costs = [...new Set(segments.flatMap((items) => items.map(({ cost }) => cost)))].sort(
    (left, right) => left - right,
  );
  const counts = new Array<number>(pairTargets.length).fill(0);
  let remaining = pairUnits;

  for (const cost of costs) {
    for (let category = pairTargets.length - 1; category >= 0; category -= 1) {
      const capacity = segments[category]
        .filter((segment) => segment.cost === cost)
        .reduce((sum, segment) => sum + segment.count, 0);
      const assigned = Math.min(remaining, capacity);
      counts[category] += assigned;
      remaining -= assigned;
      if (remaining === 0) return counts;
    }
  }

  throw new Error('Symmetric allocation marginal support was unexpectedly finite');
}

function marginalSegments(target: PairTarget): readonly MarginalSegment[] {
  const boundaries = new Set([0]);
  for (const value of [target.negative, target.positive]) {
    const breakpoint = Math.max(0, Math.floor(value));
    boundaries.add(breakpoint);
    boundaries.add(breakpoint + 1);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  const segments: MarginalSegment[] = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (end > start) {
      segments.push({ cost: pairMarginalCost(start, target), count: end - start });
    }
  }
  const last = ordered.at(-1)!;
  segments.push({ cost: pairMarginalCost(last, target), count: Number.POSITIVE_INFINITY });
  return mergeEqualCostSegments(segments);
}

function pairMarginalCost(count: number, target: PairTarget): number {
  const cost =
    absoluteValueMarginalCost(count, target.negative) +
    absoluteValueMarginalCost(count, target.positive);
  return Math.abs(cost) <= 1e-14 ? 0 : cost;
}

function absoluteValueMarginalCost(count: number, target: number): number {
  if (target <= count) return 1;
  if (target >= count + 1) return -1;
  return 2 * count + 1 - 2 * target;
}

function mergeEqualCostSegments(segments: readonly MarginalSegment[]): readonly MarginalSegment[] {
  const result: MarginalSegment[] = [];
  for (const segment of segments) {
    const previous = result.at(-1);
    if (previous?.cost === segment.cost) {
      result[result.length - 1] = {
        cost: segment.cost,
        count: previous.count + segment.count,
      };
    } else {
      result.push(segment);
    }
  }
  return result;
}
