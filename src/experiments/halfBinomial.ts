import cdf from '@stdlib/stats-base-dists-binomial-cdf';
import quantile from '@stdlib/stats-base-dists-binomial-quantile';

export type HalfBinomialQuantile = (u: number, count: number) => number;

/** Experimental inverse CDF for valid u in [0,1] and nonnegative integer counts.
 * Use stdlib's own CDF values to retain its floating-point boundary conventions.
 * Tables are deterministic, bounded, shared across draws, and built on first use.
 */
export function createHalfBinomialQuantile(maxCount: number): HalfBinomialQuantile {
  if (!Number.isSafeInteger(maxCount) || maxCount < 0 || maxCount > 256) {
    throw new RangeError('Use a table limit between 0 and 256');
  }
  const tables = new Map<number, Float64Array>();
  return (u, count) => {
    if (count > maxCount) return quantile(u, count, 0.5);
    if (u === 0 || count === 0) return 0;
    if (u === 1) return count;
    let table = tables.get(count);
    if (!table) {
      table = Float64Array.from({ length: count }, (_, k) => cdf(k, count, 0.5));
      tables.set(count, table);
    }
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (table[mid] >= u) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
}

export const HALF_BINOMIAL_TABLE_LIMIT = 256;
export const halfBinomialQuantile = createHalfBinomialQuantile(HALF_BINOMIAL_TABLE_LIMIT);
