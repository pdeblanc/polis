/// <reference types="node" />
import { Birds2aExpansion, type ExpansionCell } from '../models/birds2a/expansion';

// Positional arguments: expansion count, density, diffusion, seed.
const args = process.argv.slice(2);
let fullJson = false, origin: ExpansionCell | undefined;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') fullJson = true;
  else if (args[i] === '--origin') {
    if (i + 2 >= args.length) throw new Error('--origin requires min and max coordinates');
    origin = { min: Number(args[++i]), max: Number(args[++i]) };
  } else positional.push(args[i]);
}
if (positional.length > 4) throw new Error('Usage: experiment:birds-expansion -- [expansions=3] [density=2] [diffusion=0.5] [seed] [--origin min max] [--json]');
const expansions = Number(positional[0] ?? 3);
if (!Number.isSafeInteger(expansions) || expansions < 0) throw new RangeError('Expansion count must be a nonnegative safe integer');
const density = Number(positional[1] ?? 2), diffusion = Number(positional[2] ?? 0.5);
const seed = positional[3] ?? 'Polis expansion prototype';
const model = new Birds2aExpansion(seed, density, diffusion, origin);
let retainedSteps = 0, retainedAllocations = 0, retainedBridgeBatches = 0;
for (let index = 0; index <= expansions; index++) {
  const start = performance.now();
  const epoch = model.getEpoch(index);
  const elapsedMs = performance.now() - start;
  const extensions = epoch.kind === 'expanded' ? [epoch.forwardExtension, epoch.backwardExtension] : [];
  const steps = epoch.kind === 'initial' ? [epoch.forwardStep, epoch.backwardStep]
    : extensions.flatMap((e) => [e.direct, e.fromTwo, ...e.steps]);
  steps.push(...epoch.ordinaryFlows);
  retainedSteps += steps.length;
  retainedAllocations += steps.reduce((s, step) => s + step.allocations.length, 0);
  retainedBridgeBatches += extensions.reduce((s, e) => s + e.firstBridges.length + e.secondBridges.length, 0);
  console.log(JSON.stringify(fullJson ? epoch : {
    index, seed, density, diffusion, origin: epoch.origin, population: epoch.population,
    cellWidth: epoch.cellWidth, timeStep: epoch.timeStep,
    forwardCells: epoch.forward.contributions.length,
    backwardCells: epoch.backward.contributions.length,
    retainedEpochs: model.retainedEpochCount, retainedSteps, retainedAllocations, retainedBridgeBatches, elapsedMs,
  }));
}
