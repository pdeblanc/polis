import normalCdf from '@stdlib/stats-base-dists-normal-cdf';
import type { Interval1D } from './brownian';

export interface BrownianObservation extends Interval1D { readonly time: number }

// Numerical integration limits, NOT the simulation's bounded-noise convention.
// A standard normal has less than 4e-33 probability outside ±12.
const TAIL = 12;
const TOLERANCE = 1e-10;
const LANDMARKS = [-12, -8, -4, -2, -1, 0, 1, 2, 4, 8, 12];

/** Integral over starting positions of the probability of all observations.
 * Two-sided Brownian motion has independent past/future conditional on X(0),
 * with displacement variance diffusionRate * elapsed time. No cell-center or
 * uniform-within-a-later-cell approximation is used.
 */
export function brownianMarginalMass(origin: Interval1D, observations: readonly BrownianObservation[], diffusionRate: number): number {
  if (!Number.isFinite(diffusionRate) || diffusionRate < 0) throw new RangeError('Invalid diffusion rate');
  for (const interval of [origin, ...observations]) {
    if (!Number.isFinite(interval.min) || !Number.isFinite(interval.max) || interval.max <= interval.min) {
      throw new RangeError('Expected finite increasing interval bounds');
    }
  }
  if (observations.some(({ time }) => !Number.isFinite(time))) throw new RangeError('Expected finite times');
  let initial = { ...origin };
  const positive: BrownianObservation[] = [], negative: BrownianObservation[] = [];
  for (const observation of observations) {
    if (observation.time === 0 || diffusionRate === 0) initial = intersect(initial, observation);
    else (observation.time > 0 ? positive : negative).push({ ...observation, time: Math.abs(observation.time) });
  }
  if (initial.max <= initial.min) return 0;
  const branches = [positive, negative].map((branch) => {
    const merged: BrownianObservation[] = [];
    for (const cell of branch.sort((a, b) => a.time - b.time)) {
      const previous = merged.at(-1);
      if (previous?.time === cell.time) merged[merged.length - 1] = { ...intersect(previous, cell), time: cell.time };
      else merged.push(cell);
    }
    return merged;
  }).filter((branch) => branch.length);
  if (branches.some((branch) => branch.some((cell) => cell.max <= cell.min))) return 0;
  if (!branches.length) return initial.max - initial.min;

  if (branches.length === 1) {
    const [first, ...rest] = branches[0];
    const sigma = Math.sqrt(diffusionRate * first.time);
    const bounds = intersect(first, { min: initial.min - TAIL * sigma, max: initial.max + TAIL * sigma });
    // Integrate the exact initial intensity over the first observed interval.
    return integrate((x) => normalInterval(initial.min - x, initial.max - x, sigma) *
      continuation(x, first.time, rest, diffusionRate), bounds,
    [...landmarks(initial, sigma), ...futureLandmarks(first.time, rest, diffusionRate)],
    TOLERANCE * Math.min(initial.max - initial.min, first.max - first.min));
  }
  return integrate((x) => branches.reduce((p, branch) => p * continuation(x, 0, branch, diffusionRate), 1),
    initial, branches.flatMap((branch) => futureLandmarks(0, branch, diffusionRate)),
    TOLERANCE * (initial.max - initial.min));
}

function continuation(x: number, time: number, observations: readonly BrownianObservation[], diffusion: number): number {
  if (!observations.length) return 1;
  const [next, ...rest] = observations;
  const sigma = Math.sqrt(diffusion * (next.time - time));
  if (rest.length === 0) return normalInterval(next.min - x, next.max - x, sigma);
  const bounds = { min: Math.max(-TAIL, (next.min - x) / sigma), max: Math.min(TAIL, (next.max - x) / sigma) };
  const points = [...LANDMARKS, ...futureLandmarks(next.time, rest, diffusion).map((point) => (point - x) / sigma)];
  return integrate((z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) *
    continuation(x + sigma * z, next.time, rest, diffusion), bounds, points, TOLERANCE);
}

function normalInterval(min: number, max: number, sigma: number): number {
  // Subtract survival probabilities in the positive tail to avoid 1 - 1.
  return min >= 0 ? normalCdf(-min / sigma, 0, 1) - normalCdf(-max / sigma, 0, 1)
    : normalCdf(max / sigma, 0, 1) - normalCdf(min / sigma, 0, 1);
}
function intersect(a: Interval1D, b: Interval1D): Interval1D {
  return { min: Math.max(a.min, b.min), max: Math.min(a.max, b.max) };
}
function landmarks(interval: Interval1D, sigma: number): number[] {
  return LANDMARKS.flatMap((z) => [interval.min + z * sigma, interval.max + z * sigma]);
}
function futureLandmarks(time: number, observations: readonly BrownianObservation[], diffusion: number): number[] {
  return observations.flatMap((cell) => landmarks(cell, Math.sqrt(diffusion * (cell.time - time))));
}

// Adaptive Simpson integration, split at Gaussian boundary-layer landmarks so
// a very narrow peak cannot hide between the initial samples of a wide interval.
function integrate(f: (x: number) => number, bounds: Interval1D, landmarks: readonly number[], tolerance: number): number {
  if (bounds.max <= bounds.min) return 0;
  const points = [...new Set([bounds.min, ...landmarks.filter((x) => x > bounds.min && x < bounds.max), bounds.max])].sort((a, b) => a - b);
  let result = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], middle = a + (b - a) / 2;
    const fa = f(a), fm = f(middle), fb = f(b);
    result += adaptive(a, b, fa, fm, fb, (b - a) * (fa + 4 * fm + fb) / 6, tolerance / (points.length - 1), 20);
  }
  return result;

  function adaptive(a: number, b: number, fa: number, fm: number, fb: number, whole: number, epsilon: number, depth: number): number {
    const m = a + (b - a) / 2, l = a + (m - a) / 2, r = m + (b - m) / 2;
    const fl = f(l), fr = f(r);
    const left = (m - a) * (fa + 4 * fl + fm) / 6, right = (b - m) * (fm + 4 * fr + fb) / 6;
    const delta = left + right - whole;
    if (Math.abs(delta) <= 15 * epsilon) return left + right + delta / 15;
    if (!depth || l === a || r === b) throw new RangeError('Brownian marginal integration did not converge');
    return adaptive(a, m, fa, fl, fm, left, epsilon / 2, depth - 1) + adaptive(m, b, fm, fr, fb, right, epsilon / 2, depth - 1);
  }
}
