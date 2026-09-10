import { describe, expect, it } from 'vitest';
import { GammaProcess } from './gammaProcess';
import { directPoissonRace, lazyPoissonRace, type RaceCategory } from './poissonRace';
import { createAddressedRandom } from '../utils/rng/addressedRandom';

const random = createAddressedRandom('poisson-race-tests');
function categories(seed: number, p: number[]): RaceCategory[] {
  return p.map((probability, i) => ({
    id: String(i), probability, path: new GammaProcess(random, [seed, String(i)]),
  }));
}

describe('Poisson-race multinomial experiment', () => {
  it('matches direct merging with fresh paths and reordered categories', () => {
    for (let seed = 0; seed < 35; seed++) {
      for (const n of [0, 1, 3, 32, 100]) {
        const p = [0.125, 0, 0.375, 0.5];
        const expected = directPoissonRace(n, categories(seed, p));
        expect(lazyPoissonRace(n, categories(seed, p))).toEqual(expected);
        expect(lazyPoissonRace(n, categories(seed, p).reverse()).reverse()).toEqual(expected);
      }
    }
  });

  it('conserves counts, couples n, and satisfies likelihood-ratio and population monotonicity', () => {
    for (let seed = 0; seed < 120; seed++) {
      const p = [0.2, 0.3, 0.5];
      const q = seed % 2 ? [0.45, 0.3, 0.25] : [0.35, 0.5, 0.15];
      const paths = categories(seed, p);
      for (const n of [1, 8, 50]) {
        const x = lazyPoissonRace(n, paths);
        const next = lazyPoissonRace(n + 1, paths);
        expect(x.reduce((s, v) => s + v, 0)).toBe(n);
        expect(x.every((v) => Number.isSafeInteger(v) && v >= 0)).toBe(true);
        expect(next.every((v, i) => v >= x[i])).toBe(true);
        const y = lazyPoissonRace(n, paths.map((c, i) => ({ ...c, probability: q[i] })));
        expect(y.reduce((s, v, i) => s + (v - x[i]) * Math.log(q[i] / p[i]), 0)).toBeGreaterThanOrEqual(-1e-12);
        for (let i = 0; i < p.length; i++) for (let j = 0; j < p.length; j++) {
          if (q[i] / p[i] > q[j] / p[j]) expect(y[i] < x[i] && y[j] > x[j]).toBe(false);
        }
      }
    }
  });

  it('retains the stronger sample-ratio counterexample', () => {
    const streams = [[0.1, 1, 2], [0.2, 0.4, 2], [0.35, 0.9, 2]];
    const paths = streams.map((times, i) => ({
      id: String(i), probability: 1 / 3, path: { value: (m: number) => times[m - 1] },
    }));
    expect(lazyPoissonRace(3, paths)).toEqual([1, 1, 1]);
    expect(lazyPoissonRace(3, paths.map((c, i) => ({ ...c, probability: [0.4, 1 / 3, 4 / 15][i] })))).toEqual([1, 2, 0]);
  });

  it('handles ties deterministically and zero-probability categories', () => {
    const paths = ['b', 'a', 'c'].map((id) => ({
      id, probability: 1 / 3, path: { value: () => 1 },
    }));
    expect(lazyPoissonRace(20, paths)).toEqual([0, 20, 0]);
    expect(directPoissonRace(20, paths)).toEqual([0, 20, 0]);
    expect(lazyPoissonRace(1000, categories(0, [0, 1, 0]))).toEqual([0, 1000, 0]);
  });

  it('bounds selection work at a billion trials without materializing arrivals', () => {
    const n = 1e9;
    const paths = categories(17, [0.2, 0.3, 0.5]);
    const stats = { probes: 0, comparisons: 0, pivots: 0 };
    const result = lazyPoissonRace(n, paths, stats);
    expect(result.reduce((s, v) => s + v, 0)).toBe(n);
    const levels = Math.ceil(Math.log2(n + 1)) + 1;
    expect(stats.pivots).toBeLessThanOrEqual(3 * levels);
    expect(stats.probes).toBeLessThanOrEqual(3 * levels * (1 + 3 * levels));
  });

  it('has multinomial moments and covariance', () => {
    const count = 1200;
    const sums = [0, 0, 0];
    const squares = [0, 0, 0];
    let cross = 0;
    for (let seed = 0; seed < count; seed++) {
      const x = lazyPoissonRace(20, categories(seed, [0.2, 0.3, 0.5]));
      x.forEach((v, i) => { sums[i] += v; squares[i] += v * v; });
      cross += x[0] * x[1];
    }
    const means = sums.map((v) => v / count);
    [4, 6, 10].forEach((v, i) => expect(Math.abs(means[i] - v)).toBeLessThan(0.25));
    [3.2, 4.2, 5].forEach((v, i) => expect(Math.abs(squares[i] / count - means[i] ** 2 - v)).toBeLessThan(0.7));
    expect(Math.abs(cross / count - means[0] * means[1] + 1.2)).toBeLessThan(0.4);
  });
});
