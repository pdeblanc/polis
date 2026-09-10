export interface RaceCategory {
  readonly id: string;
  readonly probability: number;
  readonly path: { value(index: number): number };
}

export interface RaceStats {
  probes: number;
  comparisons: number;
  pivots: number;
}

interface Arrival { time: number; id: string; index: number }

function prepare(n: number, categories: readonly RaceCategory[]) {
  if (!Number.isSafeInteger(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Invalid race population');
  }
  if (!categories.length || new Set(categories.map((c) => c.id)).size !== categories.length ||
      categories.some((c) => !Number.isFinite(c.probability) || c.probability < 0) ||
      Math.abs(categories.reduce((s, c) => s + c.probability, 0) - 1) > 1e-12) {
    throw new RangeError('Invalid race categories');
  }
}

function arrival(category: RaceCategory, index: number, stats: RaceStats): Arrival {
  stats.probes++;
  const time = category.path.value(index) / category.probability;
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Invalid scaled arrival');
  return { time, id: category.id, index };
}

function compare(a: Arrival, b: Arrival, stats: RaceStats): number {
  stats.comparisons++;
  // A total order also handles rounded equal times within one stream. It is independent
  // of input category order, but numerical ties may perturb ideal coupling guarantees.
  return a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.index - b.index);
}

export function directPoissonRace(
  n: number, categories: readonly RaceCategory[],
  stats: RaceStats = { probes: 0, comparisons: 0, pivots: 0 },
): number[] {
  prepare(n, categories);
  const counts = categories.map(() => 0);
  if (!n) return counts;
  const next = categories.map((c) => c.probability ? arrival(c, 1, stats) : undefined);
  for (let draw = 0; draw < n; draw++) {
    let winner = -1;
    for (let i = 0; i < next.length; i++) {
      if (next[i] && (winner < 0 || compare(next[i]!, next[winner]!, stats) < 0)) winner = i;
    }
    counts[winner]++;
    if (draw + 1 < n) next[winner] = arrival(categories[winner], counts[winner] + 1, stats);
  }
  return counts;
}

/** Simple rank-based selection, not the optimal sorted-list selection algorithm.
 * Each pivot halves a largest candidate range. There are O(k log(n+1)) pivots,
 * each doing k binary searches: O(k^2 log^2(n+1)) arrival probes in the worst case.
 */
export function lazyPoissonRace(
  n: number, categories: readonly RaceCategory[],
  stats: RaceStats = { probes: 0, comparisons: 0, pivots: 0 },
): number[] {
  prepare(n, categories);
  if (!n) return categories.map(() => 0);
  const low = categories.map(() => 1);
  const high = categories.map((c) => c.probability ? n : 0);
  while (true) {
    let owner = -1;
    for (let i = 0; i < categories.length; i++) {
      if (low[i] <= high[i] && (owner < 0 || high[i] - low[i] > high[owner] - low[owner])) owner = i;
    }
    if (owner < 0) throw new Error('Race selection lost its target');
    stats.pivots++;
    const index = low[owner] + Math.floor((high[owner] - low[owner]) / 2);
    const pivot = arrival(categories[owner], index, stats);
    const ranks = categories.map((category) => {
      if (!category.probability) return 0;
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = lo + Math.ceil((hi - lo) / 2);
        if (compare(arrival(category, mid, stats), pivot, stats) <= 0) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    });
    // Use bigint only for aggregate ranks: k*n may exceed safe integer arithmetic.
    const rank = ranks.reduce((s, r) => s + BigInt(r), 0n);
    if (rank === BigInt(n)) return ranks;
    for (let i = 0; i < categories.length; i++) {
      if (rank < BigInt(n)) low[i] = Math.max(low[i], ranks[i] + 1);
      else high[i] = Math.min(high[i], ranks[i] - (i === owner ? 1 : 0));
    }
  }
}
