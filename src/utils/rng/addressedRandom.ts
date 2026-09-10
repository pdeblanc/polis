import { rapidhash } from 'rapidhash-js/v3.0';
import { encodeAddress, type Address } from './address';
import { profileAddressEncoding, profileHash } from '../distributions/profiling';

export type Seed = string;

export interface AddressedRandom {
  randomU64(address: Address): bigint;
  /** Optional acceleration; equivalent to prepending these address components. */
  withPrefix?(prefix: Address): AddressedRandom;
}

/** Snapshot a prefix, including mutable byte components, once per scoped RNG. */
export function prefixRandom(random: AddressedRandom, prefix: Address): AddressedRandom {
  if (random.withPrefix) return random.withPrefix(prefix);
  const snapshot = prefix.map((part) => part instanceof Uint8Array ? part.slice() : part);
  return { randomU64: (suffix) => random.randomU64([...snapshot, ...suffix]) };
}

const SEED_DERIVATION_KEY = 0x706f_6c69_7332_3032n;

export function createAddressedRandom(seed: Seed): AddressedRandom {
  const numericSeed = rapidhash(encodeAddress(['polis.seed', seed]), {
    seed: SEED_DERIVATION_KEY,
  });
  const options = { seed: numericSeed } as const;

  function scoped(encodedPrefix?: Uint8Array): AddressedRandom {
    return {
      randomU64(address) {
        const encoded = profileAddressEncoding(() => encodeAddress(address, encodedPrefix));
        return profileHash(() => rapidhash(encoded, options));
      },
      withPrefix(prefix) {
        return scoped(profileAddressEncoding(() => encodeAddress(prefix, encodedPrefix)));
      },
    };
  }
  return scoped();
}
