import gamma from '@stdlib/random-base-gamma';
import beta from '@stdlib/random-base-beta';
import type { Address } from '../utils/rng/address';
import type { AddressedRandom } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';

export interface GammaProcessStats {
  gammaSamples: number;
  betaSamples: number;
  uniforms: number;
  cacheHits: number;
  betaEndpoints: number;
  collapsedSplits: number;
  gammaMilliseconds: number;
  betaMilliseconds: number;
}

/** Research prototype: untruncated unit-scale gamma process, not a production sampler. */
export class GammaProcess {
  readonly stats: GammaProcessStats = {
    gammaSamples: 0, betaSamples: 0, uniforms: 0, cacheHits: 0,
    betaEndpoints: 0, collapsedSplits: 0,
    gammaMilliseconds: 0, betaMilliseconds: 0,
  };
  readonly #random: AddressedRandom;
  readonly #address: Address;
  readonly #profile: boolean;
  readonly #values = new Map<number, number>([[0, 0]]);

  constructor(random: AddressedRandom, address: Address, profile = false) {
    this.#random = random;
    this.#address = [...address];
    this.#profile = profile;
  }

  get cacheEntries(): number { return this.#values.size; }

  clearCache(): void {
    this.#values.clear();
    this.#values.set(0, 0);
  }

  value(t: number): number {
    if (!Number.isFinite(t) || t < 0) throw new RangeError('Invalid gamma-process argument');
    const cached = this.#values.get(t);
    if (cached !== undefined) {
      this.stats.cacheHits += 1;
      return cached;
    }
    let left = 0;
    let right = 1;
    while (true) {
      if (!this.#values.has(right)) {
        this.stats.gammaSamples += 1;
        const start = this.#profile ? performance.now() : 0;
        const sample = gamma.factory({ prng: this.#uniforms(['root', left, right]) })(right - left, 1);
        if (this.#profile) this.stats.gammaMilliseconds += performance.now() - start;
        const endpoint = this.#values.get(left)! + sample;
        if (!Number.isFinite(endpoint)) throw new RangeError('Gamma endpoint overflow');
        this.#values.set(right, endpoint);
      }
      if (t <= right) break;
      left = right;
      right *= 2;
      if (!Number.isFinite(right)) throw new RangeError('Gamma root overflow');
    }
    while (t !== left && t !== right) {
      const mid = left + (right - left) / 2;
      if (mid === left || mid === right) throw new RangeError('Gamma refinement exhausted');
      if (!this.#values.has(mid)) {
        const shape = (right - left) / 2;
        this.stats.betaSamples += 1;
        const start = this.#profile ? performance.now() : 0;
        const fraction = beta.factory({ prng: this.#uniforms(['split', left, right]) })(shape, shape);
        if (this.#profile) this.stats.betaMilliseconds += performance.now() - start;
        if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
          throw new RangeError('Invalid beta sample');
        }
        if (fraction === 0 || fraction === 1) this.stats.betaEndpoints += 1;
        const lo = this.#values.get(left)!;
        const hi = this.#values.get(right)!;
        const value = lo + (hi - lo) * fraction;
        if (value === lo || value === hi) this.stats.collapsedSplits += 1;
        this.#values.set(mid, value);
      }
      if (t <= mid) right = mid;
      else left = mid;
    }
    return this.#values.get(t)!;
  }

  #uniforms(suffix: Address): () => number {
    let draw = 0;
    return () => {
      // Bound pathological rejection work by throwing, never by a biased fallback.
      if (draw >= 4096) throw new RangeError('Gamma experiment random budget exceeded');
      this.stats.uniforms += 1;
      return uniformUnit(this.#random, [...this.#address, ...suffix, draw++]);
    };
  }
}

/** The paths carry semantic category addresses; alpha and query order do not enter them. */
export function normalizedGammaSample(
  paths: readonly GammaProcess[], alpha: readonly number[],
): number[] {
  if (paths.length !== alpha.length || alpha.length === 0 ||
      alpha.some((a) => !Number.isFinite(a) || a <= 0)) {
    throw new RangeError('Dirichlet parameters must be positive and match the paths');
  }
  const values = paths.map((path, i) => path.value(alpha[i]));
  const total = values.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new RangeError('Dirichlet normalization underflow/overflow');
  }
  return values.map((value) => value / total);
}
