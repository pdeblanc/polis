import { describe, expect, it } from 'vitest';
import type { Address } from '../rng/address';
import { createAddressedRandom, type AddressedRandom } from '../rng/addressedRandom';
import { hypergeometric } from './hypergeometric';

const random = createAddressedRandom('hypergeometric-test');

function recordingRandom(random: AddressedRandom, addresses: Address[]): AddressedRandom {
  return {
    randomU64(address) {
      addresses.push(address);
      return random.randomU64(address);
    },
  };
}

describe('hypergeometric', () => {
  it('handles degenerate margins exactly', () => {
    const addresses: Address[] = [];
    const recorded = recordingRandom(random, addresses);

    expect(hypergeometric(recorded, ['zero draws'], 100, 30, 0)).toBe(0);
    expect(hypergeometric(recorded, ['zero successes'], 100, 0, 40)).toBe(0);
    expect(hypergeometric(recorded, ['all successes'], 100, 100, 40)).toBe(40);
    expect(hypergeometric(recorded, ['all draws'], 100, 30, 100)).toBe(30);
    expect(addresses).toEqual([]);
  });

  it('is deterministic and stays inside the feasible support at large counts', () => {
    const address = ['large', 1_000_000_000] as const;
    const first = hypergeometric(
      random,
      address,
      1_000_000_000,
      400_000_000,
      700_000_000,
    );
    const second = hypergeometric(
      random,
      address,
      1_000_000_000,
      400_000_000,
      700_000_000,
    );

    expect(second).toBe(first);
    expect(first).toBeGreaterThanOrEqual(100_000_000);
    expect(first).toBeLessThanOrEqual(400_000_000);
  });

  it('matches the theoretical mean and variance empirically', () => {
    const population = 5_000;
    const subpopulation = 2_000;
    const draws = 1_200;
    const sampleCount = 20_000;
    let sum = 0;
    let sumSquares = 0;

    for (let index = 0; index < sampleCount; index += 1) {
      const sample = hypergeometric(
        random,
        ['moment', index],
        population,
        subpopulation,
        draws,
      );
      sum += sample;
      sumSquares += sample * sample;
    }

    const observedMean = sum / sampleCount;
    const observedVariance = sumSquares / sampleCount - observedMean ** 2;
    const expectedMean = draws * (subpopulation / population);
    const expectedVariance =
      draws *
      (subpopulation / population) *
      (1 - subpopulation / population) *
      ((population - draws) / (population - 1));

    expect(observedMean).toBeCloseTo(expectedMean, 0);
    expect(observedVariance).toBeGreaterThan(expectedVariance * 0.9);
    expect(observedVariance).toBeLessThan(expectedVariance * 1.1);
  });

  it('stays in the exact feasible support across small parameter combinations', () => {
    for (let population = 0; population <= 20; population += 1) {
      for (let subpopulation = 0; subpopulation <= population; subpopulation += 1) {
        for (let draws = 0; draws <= population; draws += 1) {
          const sample = hypergeometric(
            random,
            ['small', population, subpopulation, draws],
            population,
            subpopulation,
            draws,
          );
          expect(sample).toBeGreaterThanOrEqual(Math.max(0, draws + subpopulation - population));
          expect(sample).toBeLessThanOrEqual(Math.min(draws, subpopulation));
        }
      }
    }
  });

  it('couples population and draw complements exactly', () => {
    const cases = [
      [100, 37, 28],
      [10_000, 137, 7_001],
      [1_000_000_000, 400_000_000, 700_000_000],
    ] as const;

    for (const [population, subpopulation, draws] of cases) {
      const address = ['symmetry', population, subpopulation, draws] as const;
      const sample = hypergeometric(random, address, population, subpopulation, draws);
      expect(hypergeometric(random, address, population, population - subpopulation, draws)).toBe(
        draws - sample,
      );
      expect(hypergeometric(random, address, population, subpopulation, population - draws)).toBe(
        subpopulation - sample,
      );
    }
  });

  it('derives private draw addresses beneath the caller prefix', () => {
    const addresses: Address[] = [];
    hypergeometric(
      recordingRandom(random, addresses),
      ['owned-flow', 12],
      1_000_000,
      400_000,
      300_000,
    );

    expect(addresses.length).toBeGreaterThanOrEqual(2);
    for (const address of addresses) {
      expect(address.slice(0, 2)).toEqual(['owned-flow', 12]);
    }
  });

  it('rejects infeasible or inexact integer parameters', () => {
    expect(() => hypergeometric(random, ['bad'], 10, 11, 2)).toThrow(
      RangeError,
    );
    expect(() => hypergeometric(random, ['bad'], 10, 3, 2.5)).toThrow(
      RangeError,
    );
  });
});
