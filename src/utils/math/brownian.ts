import normalCdf from '@stdlib/stats-base-dists-normal-cdf';

export interface Interval1D {
  readonly max: number;
  readonly min: number;
}

/**
 * Probability that Brownian motion starting uniformly in `source` lies in `destination`.
 * The displacement variance is `diffusionRate * duration`.
 */
export function brownianIntervalTransitionProbability(
  source: Interval1D,
  destination: Interval1D,
  duration: number,
  diffusionRate: number,
): number {
  validateInterval(source, 'Brownian source');
  validateInterval(destination, 'Brownian destination');
  if (!Number.isFinite(duration) || duration < 0) {
    throw new RangeError('Brownian duration must be finite and nonnegative');
  }
  if (!Number.isFinite(diffusionRate) || diffusionRate < 0) {
    throw new RangeError('Brownian diffusion rate must be finite and nonnegative');
  }

  const variance = diffusionRate * duration;
  if (variance === 0) {
    const overlap = Math.max(
      0,
      Math.min(source.max, destination.max) - Math.max(source.min, destination.min),
    );
    return overlap / (source.max - source.min);
  }

  const standardDeviation = Math.sqrt(variance);
  const destinationMaximumIntegral =
    integratedCdf(destination.max, source.max, standardDeviation) -
    integratedCdf(destination.max, source.min, standardDeviation);
  const destinationMinimumIntegral =
    integratedCdf(destination.min, source.max, standardDeviation) -
    integratedCdf(destination.min, source.min, standardDeviation);
  const probability =
    (destinationMaximumIntegral - destinationMinimumIntegral) / (source.max - source.min);
  // Roundoff in distant tails can produce values just outside the probability interval.
  return Math.max(0, Math.min(1, probability));
}

/** Antiderivative in `x` of Phi((boundary - x) / standardDeviation). */
function integratedCdf(boundary: number, x: number, standardDeviation: number): number {
  const z = (boundary - x) / standardDeviation;
  const density = Math.exp(-0.5 * z ** 2) / Math.sqrt(2 * Math.PI);
  return (x - boundary) * normalCdf(z, 0, 1) - standardDeviation * density;
}

function validateInterval(interval: Interval1D, name: string): void {
  if (!Number.isFinite(interval.min) || !Number.isFinite(interval.max) || interval.max <= interval.min) {
    throw new RangeError(`${name} must have finite, increasing bounds`);
  }
}
