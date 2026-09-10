import { describe, expect, it } from 'vitest';
import cdf from '@stdlib/stats-base-dists-binomial-cdf';
import quantile from '@stdlib/stats-base-dists-binomial-quantile';
import { createHalfBinomialQuantile } from './halfBinomial';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';

describe('tabulated half-binomial quantiles', () => {
  it('matches stdlib at every table boundary and neighboring floats', () => {
    const sample = createHalfBinomialQuantile(256);
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    for (let n = 0; n <= 256; n++) {
      expect(sample(0, n)).toBe(0);
      expect(sample(1, n)).toBe(n);
      for (let k = 0; k < n; k++) {
        const u = cdf(k, n, 0.5);
        view.setFloat64(0, u);
        const bits = view.getBigUint64(0);
        for (const offset of [-1n, 0n, 1n]) {
          view.setBigUint64(0, bits + offset);
          const v = view.getFloat64(0);
          if (v >= 0 && v <= 1) expect(sample(v, n)).toBe(quantile(v, n, 0.5));
        }
      }
    }
  });

  it('matches addressed draws and falls back beyond each table limit', () => {
    const random = createAddressedRandom('half-binomial-tests');
    for (const limit of [0, 16, 64, 256]) {
      const sample = createHalfBinomialQuantile(limit);
      for (const n of [1, 5, 16, 64, 256, 257, 1024, 1e9]) for (let i = 0; i < 100; i++) {
        const u = uniformUnit(random, [n, i]);
        // stdlib can return -0 from its initial rounded guess; both denote zero birds.
        expect(sample(u, n) + 0).toBe(quantile(u, n, 0.5) + 0);
      }
    }
  });
});
