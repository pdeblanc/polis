import { createAddressedRandom } from '../utils/rng/addressedRandom';
import { uniformUnit } from '../utils/distributions/uniform';

export interface EvaluationCase { L: number; D: number; mu: number; rho: number; T: number }
export interface EvaluationPlan {
  tier: 'smoke' | 'standard-A'; cases: EvaluationCase[]; strata: readonly (readonly [number, number])[]; trialsPerCase: number;
}
export function evaluationPlan(tier: EvaluationPlan['tier']): EvaluationPlan {
  if (tier === 'smoke') return { tier, trialsPerCase: 32,
    cases: [4, 1].flatMap((L) => [0.5, 2].map((D) => ({ L, D, mu: 4, rho: 4 / L, T: L * L / 4 }))),
    strata: [[0, 0], [1, 1], [-1, -1], [3, -2]] };
  const random = createAddressedRandom('Polis evaluation protocol 1 locations');
  const fixed = [[0, 0], [1, 1], [-1, -1], [3, -2], [-4, 3], [17, 11], [-18, -12], [31, -5]] as const;
  const extra = Array.from({ length: 8 }, (_, j): [number, number] => [
    Math.floor(2048 * uniformUnit(random, ['space', j])) - 1024,
    Math.floor(64 * uniformUnit(random, ['time', j])) - 32,
  ]);
  return { tier, trialsPerCase: 512, strata: [...fixed, ...extra],
    cases: [16, 4, 1, 1 / 16].flatMap((L) => [0.25, 4, 64].flatMap((mu) => [0, 0.5, 1, 2, 4]
      .flatMap((D) => [0.25, 1].map((q) => ({ L, mu, D, rho: mu / L, T: q * L * L }))))) };
}
