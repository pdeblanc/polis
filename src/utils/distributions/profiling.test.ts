import { describe, expect, it } from 'vitest';
import { createAddressedRandom } from '../rng/addressedRandom';
import { multinomial } from './multinomial';
import { beginDistributionProfile, endDistributionProfile } from './profiling';

describe('distribution profiling', () => {
  it('separates nested samplers, address encoding, and hashing', () => {
    const random = createAddressedRandom('profiling');
    beginDistributionProfile();
    multinomial(random, ['profile'], 20, [
      { probability: 0.5, address: ['left'] },
      { probability: 0.5, address: ['right'] },
    ]);
    const profile = endDistributionProfile();

    expect(profile.timings.multinomial.calls).toBe(1);
    expect(profile.timings.binomial.calls).toBe(1);
    expect(profile.timings.binomial.addressEncodingMilliseconds).toBeGreaterThanOrEqual(0);
    expect(profile.timings.binomial.hashingMilliseconds).toBeGreaterThanOrEqual(0);
    expect(profile.distributionWallMilliseconds).toBeGreaterThanOrEqual(
      profile.timings.multinomial.inclusiveMilliseconds,
    );
  });
});
