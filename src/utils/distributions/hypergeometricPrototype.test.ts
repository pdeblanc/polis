import { describe, expect, it } from 'vitest';
import { createAddressedRandom } from '../rng/addressedRandom';
import { hypergeometricPrototype } from './hypergeometricPrototype';

const random = createAddressedRandom('hypergeometric-prototype-test');

describe('hypergeometricPrototype', () => {
  it('handles degenerate margins exactly', () => {
    expect(hypergeometricPrototype(random, ['zero draws'], 100, 30, 0)).toBe(0);
    expect(hypergeometricPrototype(random, ['zero successes'], 100, 0, 40)).toBe(0);
    expect(hypergeometricPrototype(random, ['all successes'], 100, 100, 40)).toBe(40);
    expect(hypergeometricPrototype(random, ['all draws'], 100, 30, 100)).toBe(30);
  });

  it('is deterministic and stays inside the feasible support at large counts', () => {
    const address = ['large', 1_000_000_000] as const;
    const first = hypergeometricPrototype(
      random,
      address,
      1_000_000_000,
      400_000_000,
      700_000_000,
    );
    const second = hypergeometricPrototype(
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
      const sample = hypergeometricPrototype(
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

  it('rejects infeasible or inexact integer parameters', () => {
    expect(() => hypergeometricPrototype(random, ['bad'], 10, 11, 2)).toThrow(
      RangeError,
    );
    expect(() => hypergeometricPrototype(random, ['bad'], 10, 3, 2.5)).toThrow(
      RangeError,
    );
  });
});
