import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { GammaProcess, normalizedGammaSample } from './gammaProcess';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const trials = Number(commandLine.process?.argv[2] ?? 2000);
if (!Number.isSafeInteger(trials) || trials < 1 || trials > 100_000) {
  throw new RangeError('Use 1 to 100000 trials');
}
const random = createAddressedRandom('gamma-process-experiment-1');

for (const alpha of [[2, 3, 5], [0.125, 0.25, 0.625], [0.001, 0.002, 0.007]]) {
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  let cross = 0;
  let valid = 0;
  let failures = 0;
  const failureReasons: Record<string, number> = {};
  let zeros = 0;
  let violations = 0;
  let collapsed = 0;
  let endpoints = 0;
  let draws = 0;
  const start = performance.now();
  for (let seed = 0; seed < trials; seed++) {
    const paths = ['a', 'b', 'c'].map((c) => new GammaProcess(random, ['dirichlet', seed, c]));
    try {
      const x = normalizedGammaSample(paths, alpha);
      const delta = alpha[2] / 4;
      const y = normalizedGammaSample(paths, [alpha[0] + delta, alpha[1], alpha[2] - delta]);
      valid++;
      x.forEach((v, i) => { sums[i] += v; squares[i] += v * v; if (v === 0) zeros++; });
      cross += x[0] * x[1];
      for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
        if (y[i] * x[j] - x[i] * y[j] < -1e-15) violations++;
      }
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      failures++;
      failureReasons[error.message] = (failureReasons[error.message] ?? 0) + 1;
    }
    for (const path of paths) {
      collapsed += path.stats.collapsedSplits;
      endpoints += path.stats.betaEndpoints;
      draws += path.stats.uniforms;
    }
  }
  const milliseconds = performance.now() - start;
  const total = alpha.reduce((a, b) => a + b, 0);
  const means = sums.map((s) => s / valid);
  const expectedMeans = alpha.map((a) => a / total);
  console.log(JSON.stringify({
    kind: 'dirichlet', alpha, trials, valid, failures, failureReasons, zeros, violations,
    means, expectedMeans,
    variances: squares.map((s, i) => s / valid - means[i] ** 2),
    expectedVariances: expectedMeans.map((p) => p * (1 - p) / (total + 1)),
    covarianceAB: cross / valid - means[0] * means[1],
    expectedCovarianceAB: -expectedMeans[0] * expectedMeans[1] / (total + 1),
    collapsed, endpoints, uniformsPerTrial: draws / trials, milliseconds,
  }));
}

for (const t of [0.5, 17, 1023, 2 ** 20 - 1, 2 ** 30 - 1, 2 ** 40 - 1]) {
  let gamma = 0;
  let beta = 0;
  let uniforms = 0;
  let sum = 0;
  let residualSquares = 0;
  const start = performance.now();
  for (let seed = 0; seed < trials; seed++) {
    const path = new GammaProcess(random, ['arrival', seed]);
    const value = path.value(t);
    sum += value;
    residualSquares += (value - t) ** 2;
    gamma += path.stats.gammaSamples;
    beta += path.stats.betaSamples;
    uniforms += path.stats.uniforms;
  }
  const milliseconds = performance.now() - start;
  console.log(JSON.stringify({
    kind: 'arrival', t, trials, mean: sum / trials, expectedMean: t,
    meanStandardErrors: (sum / trials - t) / Math.sqrt(t / trials),
    squaredResidualRatio: residualSquares / trials / t,
    gammaPerQuery: gamma / trials, betaPerQuery: beta / trials,
    uniformsPerQuery: uniforms / trials, microsecondsPerQuery: milliseconds * 1000 / trials,
  }));
}
