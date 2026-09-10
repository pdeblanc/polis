import { describe, expect, it } from 'vitest';
import { encodeAddress, type Address } from './address';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('encodeAddress', () => {
  it('reuses encoded prefixes without changing bytes or component boundaries', () => {
    const parts: Address = ['🌲', -0, 1.25, -258n, 0n, Uint8Array.of(1, 2), '', 'end'];
    for (let split = 0; split <= parts.length; split++) {
      expect(encodeAddress(parts.slice(split), encodeAddress(parts.slice(0, split))))
        .toEqual(encodeAddress(parts));
    }
  });
  it('matches the canonical binary format', () => {
    expect(toHex(encodeAddress(['star', 1.5, -258n, Uint8Array.of(0, 255)]))).toBe(
      [
        '01',
        '04000000',
        '73746172',
        '02',
        '000000000000f83f',
        '03',
        '01',
        '02000000',
        '0102',
        '04',
        '02000000',
        '00ff',
      ].join(''),
    );
  });

  it('is deterministic and does not retain mutable input bytes', () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const address: Address = ['domain', bytes];
    const encoded = encodeAddress(address);

    bytes[0] = 9;

    expect(toHex(encoded)).toBe(toHex(encodeAddress(['domain', Uint8Array.of(1, 2, 3)])));
  });

  it('keeps component types and boundaries distinct', () => {
    const encodings = [
      encodeAddress([1]),
      encodeAddress([1n]),
      encodeAddress(['1']),
      encodeAddress([Uint8Array.of(49)]),
      encodeAddress(['ab', 'c']),
      encodeAddress(['a', 'bc']),
      encodeAddress(['abc']),
    ].map(toHex);

    expect(new Set(encodings).size).toBe(encodings.length);
  });

  it('normalizes negative zero', () => {
    expect(encodeAddress([-0])).toEqual(encodeAddress([0]));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite number %s',
    (value) => {
      expect(() => encodeAddress([value])).toThrow('Address numbers must be finite');
    },
  );

  it.each(['\ud800', '\udc00', 'valid\ud800text'])(
    'rejects malformed Unicode %j',
    (value) => {
      expect(() => encodeAddress([value])).toThrow(
        'Address strings must contain well-formed Unicode',
      );
    },
  );

  it('accepts valid surrogate pairs', () => {
    expect(() => encodeAddress(['🗺️'])).not.toThrow();
  });
});
