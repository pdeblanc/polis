import hypergeometricRandom from '@stdlib/random-base-hypergeometric';
import binomialQuantile from '@stdlib/stats-base-dists-binomial-quantile';
import normalQuantile from '@stdlib/stats-base-dists-normal-quantile';
import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { bench, describe } from 'vitest';
import { binomialHalf } from '../utils/distributions/binomialHalf';
import { hypergeometricPrototype } from '../utils/distributions/hypergeometricPrototype';
import { normal } from '../utils/distributions/normal';
import { poisson, POISSON_UPPER_TAIL_PROBABILITY } from '../utils/distributions/poisson';
import { uniform, uniformUnit } from '../utils/distributions/uniform';
import type { Address } from '../utils/rng/address';
import { createAddressedRandom } from '../utils/rng/addressedRandom';

const QUANTILES = makeQuantiles(4_096);
const LARGE_COUNT = 1_000_000_000;
const random = createAddressedRandom('distribution-benchmark');
const rawHypergeometric = hypergeometricRandom.factory({ prng: nextQuantile });
const addressedHypergeometricFactory = hypergeometricRandom.factory({
  prng: nextHypergeometricUniform,
});
const MULTIVARIATE_CAPACITIES = [16, 16, 16, 16, 16, 16, 16, 16] as const;
let quantileIndex = 0;
let addressIndex = 0;
let hypergeometricAddress: Address = ['distribution-benchmark', 'uninitialized'];
let hypergeometricDrawIndex = 0;
let sink = 0;

describe('raw distribution transforms', () => {
  bench('uniform', () => {
    sink = -1 + 2 * nextQuantile();
  });

  bench('normal', () => {
    sink = normalQuantile(nextQuantile(), 0, 1);
  });

  bench('Poisson, mean 1e9', () => {
    sink = poissonQuantile(
      Math.min(nextQuantile(), 1 - POISSON_UPPER_TAIL_PROBABILITY),
      LARGE_COUNT,
    );
  });

  bench('binomial, n 1e9, p 0.5', () => {
    sink = binomialQuantile(nextQuantile(), LARGE_COUNT, 0.5);
  });
});

describe('complete addressed samplers', () => {
  bench('uniform', () => {
    sink = uniform(random, nextAddress(), -1, 1);
  });

  bench('normal', () => {
    sink = normal(random, nextAddress(), 0, 1);
  });

  bench('Poisson, mean 1e9', () => {
    sink = poisson(random, nextAddress(), LARGE_COUNT);
  });

  bench('binomial, n 1e9, p 0.5', () => {
    sink = binomialHalf(random, nextAddress(), LARGE_COUNT);
  });
});

describe('exact quantile scaling', () => {
  for (const count of [64, 1_000, 1_000_000, LARGE_COUNT]) {
    bench(`Poisson, mean ${count}`, () => {
      sink = poissonQuantile(nextQuantile(), count);
    });

    bench(`binomial, n ${count}`, () => {
      sink = binomialQuantile(nextQuantile(), count, 0.5);
    });
  }
});

describe('hybrid addressed sampler scaling', () => {
  for (const count of [1_001, 1_000_000, LARGE_COUNT]) {
    bench(`Poisson, mean ${count}`, () => {
      sink = poisson(random, nextAddress(), count);
    });

    bench(`binomial, n ${count}`, () => {
      sink = binomialHalf(random, nextAddress(), count);
    });
  }
});

describe('@stdlib exact hypergeometric baseline', () => {
  // @stdlib's HIN implementation initializes its probability recurrence with
  // factorials. Balanced populations above 170 overflow and may not terminate, so
  // this is intentionally only a small-count baseline.
  for (const population of [32, 64, 128]) {
    bench(`raw scalar, population ${population}`, () => {
      sink = rawHypergeometric(population, population / 2, population / 2);
    });

    bench(`addressed scalar, population ${population}`, () => {
      sink = addressedHypergeometric(
        nextAddress(),
        population,
        population / 2,
        population / 2,
      );
    });
  }

  bench('addressed multivariate, 8 categories, population 128', () => {
    const result = multivariateHypergeometric(
      nextAddress(),
      MULTIVARIATE_CAPACITIES,
      64,
    );
    sink = result.reduce((total, count, index) => total + count * (index + 1), 0);
  });
});

describe('experimental H2PE hypergeometric scaling', () => {
  for (const population of [1_000, 1_000_000, LARGE_COUNT]) {
    bench(`addressed scalar, population ${population}`, () => {
      sink = hypergeometricPrototype(
        random,
        nextAddress(),
        population,
        population / 2,
        population / 2,
      );
    });
  }

  bench('addressed multivariate, 8 categories, population 1e9', () => {
    const result = multivariateHypergeometricPrototype(
      nextAddress(),
      new Array<number>(8).fill(LARGE_COUNT / 8),
      LARGE_COUNT / 2,
    );
    sink = result.reduce((total, count, index) => total + count * (index + 1), 0);
  });
});

function nextQuantile(): number {
  const quantile = QUANTILES[quantileIndex % QUANTILES.length];
  quantileIndex += 1;
  return quantile;
}

function nextAddress() {
  addressIndex += 1;
  return ['distribution-benchmark', addressIndex] as const;
}

function addressedHypergeometric(
  address: Address,
  population: number,
  subpopulation: number,
  draws: number,
): number {
  hypergeometricAddress = address;
  hypergeometricDrawIndex = 0;
  return addressedHypergeometricFactory(population, subpopulation, draws);
}

function nextHypergeometricUniform(): number {
  const drawAddress = [
    ...hypergeometricAddress,
    'stdlib-hypergeometric-draw',
    hypergeometricDrawIndex,
  ] as const;
  hypergeometricDrawIndex += 1;
  return uniformUnit(random, drawAddress);
}

function multivariateHypergeometric(
  address: Address,
  capacities: readonly number[],
  sampleSize: number,
): number[] {
  const result = new Array<number>(capacities.length).fill(0);
  let remainingCapacity = capacities.reduce((total, capacity) => total + capacity, 0);
  let remainingSample = sampleSize;

  for (let index = 0; index < capacities.length - 1; index += 1) {
    const capacity = capacities[index];
    remainingCapacity -= capacity;
    const count = addressedHypergeometric(
      [...address, 'category', index],
      capacity + remainingCapacity,
      capacity,
      remainingSample,
    );
    result[index] = count;
    remainingSample -= count;
  }
  result[result.length - 1] = remainingSample;
  return result;
}

function multivariateHypergeometricPrototype(
  address: Address,
  capacities: readonly number[],
  sampleSize: number,
): number[] {
  const result = new Array<number>(capacities.length).fill(0);
  let remainingCapacity = capacities.reduce((total, capacity) => total + capacity, 0);
  let remainingSample = sampleSize;

  for (let index = 0; index < capacities.length - 1; index += 1) {
    const capacity = capacities[index];
    const count = hypergeometricPrototype(
      random,
      [...address, 'category', index],
      remainingCapacity,
      capacity,
      remainingSample,
    );
    result[index] = count;
    remainingCapacity -= capacity;
    remainingSample -= count;
  }
  result[result.length - 1] = remainingSample;
  return result;
}

function makeQuantiles(length: number): number[] {
  let state = 0x1234_5678;
  return Array.from({ length }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return (state + 0.5) / 2 ** 32;
  });
}

void sink;
