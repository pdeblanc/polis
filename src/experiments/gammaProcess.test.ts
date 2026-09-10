import { describe, expect, it } from 'vitest';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { GammaProcess, normalizedGammaSample } from './gammaProcess';

describe('addressed gamma-process experiment', () => {
  it('replays exactly after reverse queries and cache clearing across root boundaries', () => {
    const random = createAddressedRandom('gamma-order');
    const points = [0, 1 / 1024, 0.3, 0.5, 1, 1.5, 2, 3, 8, 17, 1e6];
    const path = new GammaProcess(random, ['a']);
    const expected = points.map((t) => path.value(t));
    path.clearCache();
    for (let i = points.length - 1; i >= 0; i--) expect(path.value(points[i])).toBe(expected[i]);
    expect(expected).toEqual([...expected].sort((a, b) => a - b));
  });

  it('has the joint gamma increment law and Dirichlet moments', () => {
    const random = createAddressedRandom('gamma-moments');
    const n = 2000;
    const sums = [0, 0, 0, 0];
    const squares = [0, 0, 0, 0];
    let cross = 0;
    let dirichletCross = 0;
    for (let seed = 0; seed < n; seed++) {
      const paths = ['a', 'b', 'c'].map((c) => new GammaProcess(random, [seed, c]));
      const a = paths[0].value(0.5);
      const b = paths[0].value(2) - a;
      const x = normalizedGammaSample(paths, [2, 3, 5]);
      const values = [a, b, x[0], x[1]];
      values.forEach((v, i) => { sums[i] += v; squares[i] += v * v; });
      cross += a * b;
      dirichletCross += x[0] * x[1];
    }
    const means = sums.map((s) => s / n);
    const variances = squares.map((s, i) => s / n - means[i] ** 2);
    [0.5, 1.5, 0.2, 0.3].forEach((m, i) => {
      expect(Math.abs(means[i] - m)).toBeLessThan(i < 2 ? 0.12 : 0.015);
    });
    [0.5, 1.5, 0.16 / 11, 0.21 / 11].forEach((v, i) => {
      expect(Math.abs(variances[i] - v)).toBeLessThan(i < 2 ? 0.3 : 0.003);
    });
    expect(Math.abs(cross / n - means[0] * means[1])).toBeLessThan(0.1);
    expect(Math.abs(dirichletCross / n - means[2] * means[3] + 0.06 / 11)).toBeLessThan(0.002);
  });

  it('preserves the three elementary-transfer ratios', () => {
    const random = createAddressedRandom('gamma-ratios');
    for (let seed = 0; seed < 500; seed++) {
      const paths = ['a', 'b', 'c'].map((c) => new GammaProcess(random, [seed, c]));
      const x = normalizedGammaSample(paths, [0.25, 0.5, 1.25]);
      const y = normalizedGammaSample(paths, [0.5, 0.5, 1]);
      for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
        expect(y[i] * x[j] - x[i] * y[j]).toBeGreaterThanOrEqual(-1e-15);
      }
    }
  });

  it('queries large arrival indices with logarithmic scalar work', () => {
    const path = new GammaProcess(createAddressedRandom('gamma-work'), ['a']);
    expect(path.value(2 ** 30 - 1)).toBeGreaterThan(0);
    expect(path.stats.gammaSamples + path.stats.betaSamples).toBeLessThan(65);
  });
});
