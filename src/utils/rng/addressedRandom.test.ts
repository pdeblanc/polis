import { describe, expect, it } from 'vitest';
import { createAddressedRandom } from './addressedRandom';

describe('createAddressedRandom', () => {
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
