import { describe, expect, it } from 'vitest';
import { createAddressedRandom, prefixRandom } from './addressedRandom';

describe('createAddressedRandom', () => {
  it('preserves flat addresses with nested, empty, and snapshotted prefixes', () => {
    const random = createAddressedRandom('prefix-test');
    for (const source of [random, { randomU64: random.randomU64 }]) {
      const bytes = Uint8Array.of(1, 2);
      const prefix = ['🌲', -0, -258n, bytes];
      const scoped = prefixRandom(source, prefix);
      bytes[0] = 99;
      prefix.push('mutated');
      for (const suffix of [[], ['split', 1.25, 0.5], ['points', 0, 1, 3]]) {
        const expected = random.randomU64(['🌲', 0, -258n, Uint8Array.of(1, 2), ...suffix]);
        expect(scoped.randomU64(suffix)).toBe(expected);
        expect(prefixRandom(scoped, []).randomU64(suffix)).toBe(expected);
        expect(prefixRandom(scoped, suffix).randomU64([])).toBe(expected);
      }
    }
  });
  it('is deterministic for a fixed seed and address', () => {
    const first = createAddressedRandom('polis-demo-1');
    const second = createAddressedRandom('polis-demo-1');
    const address = ['starfield.count', -4, -2, -2, 0] as const;

    expect(first.randomU64(address)).toBe(second.randomU64(address));
  });

  it('keeps seeds, domains, and component boundaries separate', () => {
    const firstSeed = createAddressedRandom('polis-demo-1');
    const secondSeed = createAddressedRandom('polis-demo-2');
    const outputs = [
      firstSeed.randomU64(['starfield.count', -4, -2, -2, 0]),
      secondSeed.randomU64(['starfield.count', -4, -2, -2, 0]),
      firstSeed.randomU64(['terrain.vertex-displacement', -4, -2, -2, 0]),
      firstSeed.randomU64(['starfield.count', 'ab', 'c']),
      firstSeed.randomU64(['starfield.count', 'a', 'bc']),
    ];

    expect(new Set(outputs).size).toBe(outputs.length);
  });

  it('matches the Polis integration vector', () => {
    const random = createAddressedRandom('polis-demo-1');

    expect(random.randomU64(['starfield.count', -4, -2, -2, 0])).toBe(
      0x0fee_fded_2b5b_e6ddn,
    );
  });
});
