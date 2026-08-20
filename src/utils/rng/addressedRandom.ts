import { rapidhash } from 'rapidhash-js/v3.0';
import { encodeAddress, type Address } from './address';
import { profileAddressEncoding, profileHash } from '../distributions/profiling';

export type Seed = string;

export interface AddressedRandom {
  randomU64(address: Address): bigint;
}

const SEED_DERIVATION_KEY = 0x706f_6c69_7332_3032n;

export function createAddressedRandom(seed: Seed): AddressedRandom {
  const numericSeed = rapidhash(encodeAddress(['polis.seed', seed]), {
    seed: SEED_DERIVATION_KEY,
  });
  const options = { seed: numericSeed } as const;

  return {
    randomU64(address) {
      const encoded = profileAddressEncoding(() => encodeAddress(address));
      return profileHash(() => rapidhash(encoded, options));
    },
  };
}
