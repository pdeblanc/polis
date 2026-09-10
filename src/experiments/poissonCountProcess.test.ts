import { describe, expect, it } from 'vitest';
import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { PoissonCountProcess, countPoissonRace } from './poissonCountProcess';
import { directPoissonRace } from './poissonRace';
import { createHalfBinomialQuantile } from './halfBinomial';

const random = createAddressedRandom('count-process-tests');
const make = (seed: number, p = [0.2, 0.3, 0.5]) => p.map((probability, i) => ({
  id: String(i), probability, path: new PoissonCountProcess(random, [seed, String(i)]),
}));

describe('Poisson count hierarchy and race', () => {
  it('preserves points and draws with cached operation tags, including after clearing', () => {
    for (const source of [random, { randomU64: random.randomU64 }]) {
      const cached = new PoissonCountProcess(source, ['operation-tags'], false, 4, undefined, true);
      const plain = new PoissonCountProcess(source, ['operation-tags'], false, 4, undefined, false);
      for (let pass = 0; pass < 2; pass++) {
        for (const t of [0.5, 1000.25, 16, 1e6]) expect(cached.countBefore(t)).toBe(plain.countBefore(t));
        for (const i of [1, 4, 100]) expect(cached.arrival(i)).toBe(plain.arrival(i));
        expect(cached.stats.uniforms).toBe(plain.stats.uniforms);
        cached.clearCache();
        plain.clearCache();
      }
    }
  });
  it('keeps scalar profiling separate from RNG-inclusive timings without changing draws', () => {
    const plain = new PoissonCountProcess(random, ['profile']);
    const profiled = new PoissonCountProcess(random, ['profile'], true);
    for (const t of [1000.25, 0.5, 1024]) expect(profiled.countBefore(t)).toBe(plain.countBefore(t));
    expect(profiled.stats.uniforms).toBe(plain.stats.uniforms);
    expect(profiled.stats.poissonScalarMilliseconds).toBeGreaterThanOrEqual(0);
    expect(profiled.stats.poissonScalarMilliseconds).toBeLessThanOrEqual(profiled.stats.poissonMilliseconds);
    expect(profiled.stats.binomialScalarMilliseconds).toBeGreaterThanOrEqual(0);
    expect(profiled.stats.binomialScalarMilliseconds).toBeLessThanOrEqual(profiled.stats.binomialMilliseconds);
    expect(plain.stats.poissonScalarMilliseconds).toBe(0);
    expect(plain.stats.binomialScalarMilliseconds).toBe(0);
  });
  it('matches root scanning around powers of two, with mixed access and cache clearing', () => {
    const view = new DataView(new ArrayBuffer(8));
    const times = [0, Number.MIN_VALUE, 0.5];
    for (const exponent of [0, 1, 2, 10, 20, 30]) {
      view.setFloat64(0, 2 ** exponent);
      const bits = view.getBigUint64(0);
      for (const offset of [-1n, 0n, 1n]) {
        view.setBigUint64(0, bits + offset);
        times.push(view.getFloat64(0));
      }
    }
    const scan = new PoissonCountProcess(random, ['root-boundaries']);
    const cached = new PoissonCountProcess(random, ['root-boundaries']);
    expect(cached.arrival(100)).toBe(scan.arrival(100));
    for (const t of [...times].reverse()) expect(cached.countBefore(t)).toBe(scan.countBefore(t, 'scan'));
    expect(cached.stats.uniforms).toBe(scan.stats.uniforms);
    cached.clearCache();
    for (const t of times) expect(cached.countBefore(t)).toBe(scan.countBefore(t, 'scan'));
    expect(cached.arrival(100)).toBe(scan.arrival(100));
  });

  it('skips preceding roots on repeated whole-root queries', () => {
    const cached = new PoissonCountProcess(random, ['root-visits']);
    const count = cached.countBefore(2 ** 20);
    const { visits, uniforms } = cached.stats;
    expect(cached.countBefore(2 ** 20)).toBe(count);
    expect(cached.stats.visits - visits).toBe(1);
    expect(cached.stats.uniforms).toBe(uniforms);
  });
  it('preserves race outputs for every splitter table limit', () => {
    const reference = createHalfBinomialQuantile(0);
    for (const limit of [16, 64, 256]) {
      const split = createHalfBinomialQuantile(limit);
      for (let seed = 0; seed < 4; seed++) for (const n of [1, 32, 1024, 1e6]) {
        const paths = (sampler: typeof split) => [0.2, 0.3, 0.5].map((probability, i) => ({
          id: String(i), probability,
          path: new PoissonCountProcess(random, [seed, String(i)], false, 4, sampler),
        }));
        expect(countPoissonRace(n, paths(split))).toEqual(countPoissonRace(n, paths(reference)));
      }
    }
  });
  it('matches full-address encoding when using the prefix acceleration', () => {
    for (let seed = 0; seed < 4; seed++) for (const n of [1, 32, 1024, 1e6]) {
      const full = [0.2, 0.3, 0.5].map((probability, i) => ({
        id: String(i), probability,
        path: new PoissonCountProcess({ randomU64: random.randomU64 }, [seed, String(i)]),
      }));
      expect(countPoissonRace(n, make(seed))).toEqual(countPoissonRace(n, full));
    }
  });
  it('matches bisection on fresh processes across populations and probabilities', () => {
    for (const p of [[0.2, 0.3, 0.5], [0.0001, 0.0099, 0.99], [0, 0.5, 0.5]]) {
      for (let seed = 0; seed < 12; seed++) for (const n of [1, 8, 1024, 1e6, 1e9]) {
        expect(countPoissonRace(n, make(seed, p))).toEqual(
          countPoissonRace(n, make(seed, p), { cutoffs: 0 }, 'bisection'),
        );
      }
    }
  });

  it('falls back across long gaps and tightly clustered arrivals', () => {
    for (const times of [[1e12, 1e12 + 100], [0.001, 0.001001]]) {
      const categories = [{ id: 'one', probability: 1,
        path: { countBefore: (t: number) => times.filter((v) => v < t).length } }];
      const stats = { cutoffs: 0 };
      expect(countPoissonRace(1, categories, stats)).toEqual([1]);
      expect(stats.cutoffs).toBeLessThan(250);
    }
  });
  it('defers coordinates until needed and preserves the eager construction', () => {
    const path = new PoissonCountProcess(createAddressedRandom('lazy-regression'), ['path']);
    expect(path.countBefore(8)).toBe(9);
    expect(path.stats.materializedPoints).toBe(0);
    expect(path.stats.binomialSamples).toBe(0);
    expect([0.5, 1, 2, 8, 8.25, 100].map((t) => path.countBefore(t)))
      .toEqual([1, 2, 2, 9, 9, 115]);
    expect([1, 2, 5, 20].map((i) => path.arrival(i))).toEqual([
      0.43518154924389285, 0.8258306714087589, 6.256278072722431, 14.397043669826985,
    ]);
    const points = path.stats.materializedPoints;
    path.arrival(20);
    expect(path.stats.materializedPoints).toBe(points);
  });
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
