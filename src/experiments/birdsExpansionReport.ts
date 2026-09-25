/// <reference types="node" />
import { BirdsExpansion, type ContributionStep } from './birdsExpansion';

// Positional arguments: expansion count, density, diffusion, seed; optional --json.
const args = process.argv.slice(2);
const fullJson = args.includes('--json');
const positional = args.filter((a) => a !== '--json');
if (positional.length > 4) throw new Error('Usage: experiment:birds-expansion -- [expansions=3] [density=2] [diffusion=0.5] [seed] [--json]');
const expansions = Number(positional[0] ?? 3);
if (!Number.isSafeInteger(expansions) || expansions < 0) throw new RangeError('Expansion count must be a nonnegative safe integer');
const density = Number(positional[1] ?? 2), diffusion = Number(positional[2] ?? 0.5);
const seed = positional[3] ?? 'Polis expansion prototype';
const model = new BirdsExpansion(seed, density, diffusion);
let retainedSteps = 0, retainedAllocations = 0;
for (let index = 0; index <= expansions; index++) {
  const start = performance.now();
  const epoch = model.getEpoch(index);
  const elapsedMs = performance.now() - start;
  const steps: ContributionStep[] = [
    ...epoch.introduced.flatMap((i) => [i.forwardStep, i.backwardStep]),
    ...epoch.extensions.flatMap((e) => [...e.forwardSteps, ...e.backwardSteps]),
  ];
  retainedSteps += steps.length;
  retainedAllocations += steps.reduce((s, step) => s + step.allocations.length, 0);
  console.log(JSON.stringify(fullJson ? epoch : {
    index, seed, density, diffusion, cellWidth: epoch.cellWidth, timeStep: epoch.timeStep,
    populations: epoch.roots.map((r) => r.population),
    forwardCells: epoch.roots.map((r) => r.forward.contributions.length),
    backwardCells: epoch.roots.map((r) => r.backward.contributions.length),
    retainedEpochs: model.retainedEpochCount, retainedSteps, retainedAllocations, elapsedMs,
  }));
}
