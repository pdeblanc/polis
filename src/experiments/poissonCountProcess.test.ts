import { describe, expect, it } from 'vitest';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { PoissonCountProcess, countPoissonRace } from './poissonCountProcess';
import { directPoissonRace } from './poissonRace';

const random = createAddressedRandom('count-process-tests');
const make = (seed: number, p = [0.2, 0.3, 0.5]) => p.map((probability, i) => ({
  id: String(i), probability, path: new PoissonCountProcess(random, [seed, String(i)]),
}));

describe('Poisson count hierarchy and race', () => {
  it.each([1, 2, 4, 8, 16, 32, 64])('preserves replay, coupling, and moments at cutoff %i', (cutoff) => {
    const totals = [0, 0, 0];
    const samples = 400;
    for (let seed = 0; seed < samples; seed++) {
      const paths = [0.2, 0.3, 0.5].map((probability, i) => ({
        id: String(i), probability,
        path: new PoissonCountProcess(random, ['cutoff-check', seed, String(i)], false, cutoff),
      }));
      const x = countPoissonRace(30, paths);
      x.forEach((v, i) => { totals[i] += v; });
      expect(countPoissonRace(31, paths).every((v, i) => v >= x[i])).toBe(true);
      paths.forEach((c) => c.path.clearCache());
      expect(countPoissonRace(30, paths)).toEqual(x);
      const q = [0.4, 0.3, 0.3];
      const y = countPoissonRace(30, paths.map((c, i) => ({ ...c, probability: q[i] })));
      expect(y.reduce((s, v, i) => s + (v - x[i]) * Math.log(q[i] / paths[i].probability), 0)).toBeGreaterThanOrEqual(-1e-12);
    }
    [6, 9, 15].forEach((mean, i) => expect(Math.abs(totals[i] / samples - mean)).toBeLessThan(0.5));
  });
  it('replays cumulative counts and arrival coordinates after cache clearing', () => {
    const path = new PoissonCountProcess(random, ['order']);
    const times = [0, 0.3, 1, 1.5, 2, 48, 100, 1024, 1e6];
    const counts = times.map((t) => path.countBefore(t));
    const arrival = path.arrival(100);
    expect(path.countBefore(arrival)).toBe(99);
    path.clearCache();
    expect(path.arrival(100)).toBe(arrival);
    for (let i = times.length - 1; i >= 0; i--) expect(path.countBefore(times[i])).toBe(counts[i]);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it('matches a direct arrival merge and is independent of category order', () => {
    for (let seed = 0; seed < 50; seed++) for (const n of [0, 1, 3, 32, 128]) {
      const p = [0.125, 0, 0.375, 0.5];
      const direct = directPoissonRace(n, make(seed, p).map((c) => ({
        ...c, path: { value: (index: number) => c.path.arrival(index) },
      })));
      expect(countPoissonRace(n, make(seed, p))).toEqual(direct);
      expect(countPoissonRace(n, make(seed, p).reverse()).reverse()).toEqual(direct);
    }
  });

  it('preserves n, likelihood-ratio, and population monotonicity', () => {
    for (let seed = 0; seed < 150; seed++) {
      const input = make(seed);
      const p = input.map((c) => c.probability);
      const q = seed % 2 ? [0.4, 0.3, 0.3] : [0.3, 0.5, 0.2];
      for (const n of [1, 20, 1000]) {
        const x = countPoissonRace(n, input);
        const next = countPoissonRace(n + 1, input);
        expect(x.reduce((s, v) => s + v, 0)).toBe(n);
        expect(next.every((v, i) => v >= x[i])).toBe(true);
        const y = countPoissonRace(n, input.map((c, i) => ({ ...c, probability: q[i] })));
        expect(y.reduce((s, v, i) => s + (v - x[i]) * Math.log(q[i] / p[i]), 0)).toBeGreaterThanOrEqual(-1e-12);
        for (let i = 0; i < p.length; i++) for (let j = 0; j < p.length; j++) {
          if (q[i] / p[i] > q[j] / p[j]) expect(y[i] < x[i] && y[j] > x[j]).toBe(false);
        }
      }
    }
  });

  it('matches small multinomial probabilities and independent Poisson increment moments', () => {
    const n = 1500;
    const histogram = new Map<string, number>();
    let a = 0, b = 0, aa = 0, bb = 0, ab = 0;
    for (let seed = 0; seed < n; seed++) {
      const paths = make(seed);
      const counts = countPoissonRace(3, paths);
      const key = counts.join(',');
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
      const x = paths[0].path.countBefore(48);
      const y = paths[0].path.countBefore(80) - x;
      a += x; b += y; aa += x * x; bb += y * y; ab += x * y;
    }
    let tv = 0;
    const factorial = [1, 1, 2, 6];
    for (let x = 0; x <= 3; x++) for (let y = 0; y <= 3 - x; y++) {
      const z = 3 - x - y;
      const expected = 6 / (factorial[x] * factorial[y] * factorial[z]) * 0.2 ** x * 0.3 ** y * 0.5 ** z;
      tv += Math.abs((histogram.get([x, y, z].join(',')) ?? 0) / n - expected) / 2;
    }
    expect(tv).toBeLessThan(0.065);
    expect(Math.abs(a / n - 48)).toBeLessThan(1);
    expect(Math.abs(b / n - 32)).toBeLessThan(1);
    expect(Math.abs(aa / n - (a / n) ** 2 - 48)).toBeLessThan(7);
    expect(Math.abs(bb / n - (b / n) ** 2 - 32)).toBeLessThan(5);
    expect(Math.abs(ab / n - a * b / n ** 2)).toBeLessThan(5);
  });

  it('supports large populations and reports unresolvable numerical cutoffs', () => {
    const input = make(0);
    const stats = { cutoffs: 0 };
    expect(countPoissonRace(1e9, input, stats).reduce((s, v) => s + v, 0)).toBe(1e9);
    expect(input.reduce((s, c) => s + c.path.stats.nodes, 0)).toBeLessThan(10_000);
    expect(() => countPoissonRace(1, [{
      id: 'tied', probability: 1, path: { countBefore: (t) => t > 1 ? 2 : 0 },
    }])).toThrow('No representable race cutoff');
  });

  it('still permits the stronger sample-ratio counterexample', () => {
    const points = [[0.1, 1, 2], [0.2, 0.4, 2], [0.35, 0.9, 2]];
    const paths = points.map((times, i) => ({
      id: String(i), probability: 1 / 3,
      path: { countBefore: (t: number) => times.filter((v) => v < t).length },
    }));
    expect(countPoissonRace(3, paths)).toEqual([1, 1, 1]);
    expect(countPoissonRace(3, paths.map((c, i) => ({ ...c, probability: [0.4, 1 / 3, 4 / 15][i] })))).toEqual([1, 2, 0]);
  });
});
