import { describe, expect, it } from 'vitest';
import type { ProbabilityMassTable } from '../../utils/distributions/roundedNormal';
import {
  coarseCellPopulation,
  coarseFlowCount,
  createBirdsCoarseInitialization,
  symmetricIntegerAllocation,
  type CoarseFlowAllocation,
} from './coarseInitialization';
import { BIRDS_COARSE_CELL_LENGTH } from './scales';

describe('coarseCellPopulation', () => {
  it('rounds world-space density with Math.round semantics', () => {
    expect(coarseCellPopulation(0)).toBe(0);
    expect(coarseCellPopulation(1 / (2 * BIRDS_COARSE_CELL_LENGTH))).toBe(1);
    expect(coarseCellPopulation(12.25 / BIRDS_COARSE_CELL_LENGTH)).toBe(12);
    expect(coarseCellPopulation(12.5 / BIRDS_COARSE_CELL_LENGTH)).toBe(13);
  });

  it('rejects semantically invalid densities', () => {
    expect(() => coarseCellPopulation(-1)).toThrow(RangeError);
    expect(() => coarseCellPopulation(Number.NaN)).toThrow(RangeError);
    expect(() => coarseCellPopulation(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('symmetricIntegerAllocation', () => {
  it('chooses the lexicographically smallest vector among equal optima', () => {
    const allocation = symmetricIntegerAllocation(2, [
      { value: -1, probability: 0.25 },
      { value: 0, probability: 0.5 },
      { value: 1, probability: 0.25 },
    ]);

    expect(countVector(allocation, [0, 1])).toEqual([0, 1]);
  });

  it('agrees with exhaustive optimization for small asymmetric tables', () => {
    let state = 0x5eed_1234;
    const nextWeight = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return 1 + (state % 100);
    };

    for (let sample = 0; sample < 50; sample += 1) {
      const weights = Array.from({ length: 5 }, nextWeight);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const table = weights.map((weight, index) => ({
        value: index - 2,
        probability: weight / total,
      }));

      for (let population = 0; population <= 16; population += 1) {
        const actual = countVector(symmetricIntegerAllocation(population, table), [0, 1, 2]);
        expect(actual).toEqual(bruteForceAllocation(population, table));
      }
    }
  });

  it('supports a center-only table', () => {
    expect(symmetricIntegerAllocation(17, [{ value: 0, probability: 1 }])).toEqual([
      { offset: 0, targetProbability: 1, count: 17 },
    ]);
  });

  it('rejects invalid populations and probability tables', () => {
    expect(() => symmetricIntegerAllocation(-1, [{ value: 0, probability: 1 }])).toThrow(
      RangeError,
    );
    expect(() => symmetricIntegerAllocation(1, [])).toThrow(RangeError);
    expect(() =>
      symmetricIntegerAllocation(1, [{ value: 0.5, probability: 1 }]),
    ).toThrow(RangeError);
    expect(() =>
      symmetricIntegerAllocation(1, [{ value: 0, probability: Number.NaN }]),
    ).toThrow(RangeError);
  });
});

describe('Birds coarse initialization', () => {
  it('conserves every coarse-cell population with reflection symmetry', () => {
    for (const populationDensity of [0, 0.01, 0.1, 1, 10]) {
      for (const diffusionRate of [0, 0.1, 1, 10]) {
        const initialization = createBirdsCoarseInitialization(
          populationDensity,
          diffusionRate,
        );

        expect(initialization.flows.reduce((sum, flow) => sum + flow.count, 0)).toBe(
          initialization.cellPopulation,
        );
        for (const flow of initialization.flows) {
          expect(flow.count).toBeGreaterThanOrEqual(0);
          expect(Number.isSafeInteger(flow.count)).toBe(true);
          expect(coarseFlowCount(initialization, -flow.offset)).toBe(flow.count);
        }
      }
    }
  });

  it('retains the complete probability support when counts round to zero', () => {
    const initialization = createBirdsCoarseInitialization(0, 1);

    expect(initialization.cellPopulation).toBe(0);
    expect(initialization.flows.length).toBeGreaterThan(1);
    expect(initialization.flows.every(({ count }) => count === 0)).toBe(true);
    expect(initialization.flows.some(({ targetProbability }) => targetProbability > 0)).toBe(true);
  });

  it('reports requested and effective density separately', () => {
    const requested = 0.101;
    const initialization = createBirdsCoarseInitialization(requested, 1);

    expect(initialization.requestedPopulationDensity).toBe(requested);
    expect(initialization.effectivePopulationDensity).toBe(
      initialization.cellPopulation / BIRDS_COARSE_CELL_LENGTH,
    );
  });

  it('keeps counts symmetric when clamp atoms make target tails asymmetric', () => {
    const standardDeviation = 2.5 / 6;
    const diffusionRate = standardDeviation ** 2 - 1 / 12;
    const initialization = createBirdsCoarseInitialization(10, diffusionRate);

    expect(initialization.flows[0].targetProbability).not.toBe(
      initialization.flows.at(-1)?.targetProbability,
    );
    for (const flow of initialization.flows) {
      expect(coarseFlowCount(initialization, -flow.offset)).toBe(flow.count);
    }
  });

  it('returns zero outside the coarse kernel support', () => {
    const initialization = createBirdsCoarseInitialization(1, 1);
    expect(coarseFlowCount(initialization, 1_000_000)).toBe(0);
    expect(coarseFlowCount(initialization, 0.5)).toBe(0);
  });
});

function countVector(
  allocation: readonly CoarseFlowAllocation[],
  offsets: readonly number[],
): readonly number[] {
  return offsets.map(
    (offset) => allocation.find((entry) => entry.offset === offset)?.count ?? 0,
  );
}

function bruteForceAllocation(
  population: number,
  table: ProbabilityMassTable,
): readonly number[] {
  const probabilities = new Map(table.map(({ value, probability }) => [value, probability]));
  let bestVector: readonly number[] | undefined;
  let bestObjective = Number.POSITIVE_INFINITY;

  for (let center = population % 2; center <= population; center += 2) {
    const remainingPairs = (population - center) / 2;
    for (let first = 0; first <= remainingPairs; first += 1) {
      const second = remainingPairs - first;
      const vector = [center, first, second];
      const counts = new Map([
        [0, center],
        [-1, first],
        [1, first],
        [-2, second],
        [2, second],
      ]);
      const objective = [-2, -1, 0, 1, 2].reduce(
        (sum, offset) =>
          sum + Math.abs((counts.get(offset) ?? 0) - population * (probabilities.get(offset) ?? 0)),
        0,
      );
      if (
        objective < bestObjective - 1e-12 ||
        (Math.abs(objective - bestObjective) <= 1e-12 &&
          (bestVector === undefined || lexicographicallyLess(vector, bestVector)))
      ) {
        bestObjective = objective;
        bestVector = vector;
      }
    }
  }

  return bestVector!;
}

function lexicographicallyLess(left: readonly number[], right: readonly number[]): boolean {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}
