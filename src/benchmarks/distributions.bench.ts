import binomialQuantile from '@stdlib/stats-base-dists-binomial-quantile';
import normalQuantile from '@stdlib/stats-base-dists-normal-quantile';
import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import { bench, describe } from 'vitest';
import { binomialHalf } from '../utils/distributions/binomialHalf';
import { normal } from '../utils/distributions/normal';
import { poisson, POISSON_UPPER_TAIL_PROBABILITY } from '../utils/distributions/poisson';
import { uniform } from '../utils/distributions/uniform';
import { createAddressedRandom } from '../utils/rng/addressedRandom';

const QUANTILES = makeQuantiles(4_096);
const LARGE_COUNT = 1_000_000_000;
const random = createAddressedRandom('distribution-benchmark');
let quantileIndex = 0;
let addressIndex = 0;
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

function nextQuantile(): number {
  const quantile = QUANTILES[quantileIndex % QUANTILES.length];
  quantileIndex += 1;
  return quantile;
}

function nextAddress() {
  addressIndex += 1;
  return ['distribution-benchmark', addressIndex] as const;
}

function makeQuantiles(length: number): number[] {
  let state = 0x1234_5678;
  return Array.from({ length }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return (state + 0.5) / 2 ** 32;
  });
}

void sink;
