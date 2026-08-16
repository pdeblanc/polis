export type AddressPart = string | number | bigint | Uint8Array;

export type Address = readonly AddressPart[];

const enum AddressTag {
  String = 0x01,
  Number = 0x02,
  BigInt = 0x03,
  Bytes = 0x04,
}

const LENGTH_BYTES = 4;
const FLOAT64_BYTES = 8;
const MAX_COMPONENT_LENGTH = 0xffff_ffff;
const textEncoder = new TextEncoder();

type PreparedPart =
  | { readonly tag: AddressTag.String; readonly bytes: Uint8Array }
  | { readonly tag: AddressTag.Number; readonly value: number }
  | {
      readonly tag: AddressTag.BigInt;
      readonly magnitude: bigint;
      readonly magnitudeLength: number;
      readonly negative: boolean;
    }
  | { readonly tag: AddressTag.Bytes; readonly bytes: Uint8Array };

/**
 * Encodes a structured random address into an unambiguous byte sequence.
 *
 * Format:
 * - string: 0x01, uint32 byte length, UTF-8 bytes
 * - number: 0x02, IEEE-754 float64 bytes
 * - bigint: 0x03, sign byte, uint32 magnitude length, big-endian magnitude
 * - bytes:  0x04, uint32 byte length, raw bytes
 *
 * Fixed-width integers use little-endian byte order. Each tag is part of the encoded
 * identity, so values such as `1`, `1n`, and `"1"` remain distinct.
 */
export function encodeAddress(address: Address): Uint8Array {
  const prepared = address.map(preparePart);
  const totalLength = prepared.reduce(
    (length, part) => addLengths(length, encodedLength(part)),
    0,
  );
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  let offset = 0;

  for (const part of prepared) {
    output[offset] = part.tag;
    offset += 1;

    switch (part.tag) {
      case AddressTag.String:
      case AddressTag.Bytes:
        view.setUint32(offset, part.bytes.length, true);
        offset += LENGTH_BYTES;
        output.set(part.bytes, offset);
        offset += part.bytes.length;
        break;

      case AddressTag.Number:
        view.setFloat64(offset, part.value, true);
        offset += FLOAT64_BYTES;
        break;

      case AddressTag.BigInt:
        output[offset] = part.negative ? 1 : 0;
        offset += 1;
        view.setUint32(offset, part.magnitudeLength, true);
        offset += LENGTH_BYTES;
        offset = writeBigIntMagnitude(output, offset, part.magnitude, part.magnitudeLength);
        break;
    }
  }

  return output;
}

function preparePart(part: AddressPart): PreparedPart {
  if (typeof part === 'string') {
    assertWellFormedUnicode(part);
    const bytes = textEncoder.encode(part);
    assertComponentLength(bytes.length);
    return { tag: AddressTag.String, bytes };
  }

  if (typeof part === 'number') {
    if (!Number.isFinite(part)) {
      throw new TypeError('Address numbers must be finite');
    }
    return {
      tag: AddressTag.Number,
      value: Object.is(part, -0) ? 0 : part,
    };
  }

  if (typeof part === 'bigint') {
    const negative = part < 0n;
    const magnitude = negative ? -part : part;
    const magnitudeLength = byteLength(magnitude);
    assertComponentLength(magnitudeLength);
    return {
      tag: AddressTag.BigInt,
      magnitude,
      magnitudeLength,
      negative,
    };
  }

  if (part instanceof Uint8Array) {
    assertComponentLength(part.length);
    return { tag: AddressTag.Bytes, bytes: part };
  }

  throw new TypeError('Unsupported address component');
}

function encodedLength(part: PreparedPart): number {
  switch (part.tag) {
    case AddressTag.String:
    case AddressTag.Bytes:
      return 1 + LENGTH_BYTES + part.bytes.length;
    case AddressTag.Number:
      return 1 + FLOAT64_BYTES;
    case AddressTag.BigInt:
      return 1 + 1 + LENGTH_BYTES + part.magnitudeLength;
  }
}

function addLengths(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError('Encoded address is too large');
  }
  return sum;
}

function assertComponentLength(length: number): void {
  if (length > MAX_COMPONENT_LENGTH) {
    throw new RangeError('Address component is too large');
  }
}

function byteLength(value: bigint): number {
  if (value === 0n) return 0;
  return Math.ceil(value.toString(16).length / 2);
}

function writeBigIntMagnitude(
  output: Uint8Array,
  offset: number,
  magnitude: bigint,
  length: number,
): number {
  let remaining = magnitude;
  for (let index = length - 1; index >= 0; index -= 1) {
    output[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return offset + length;
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError('Address strings must contain well-formed Unicode');
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError('Address strings must contain well-formed Unicode');
    }
  }
}
