import {
  deriveBirdsPopulationBound,
  deriveBirdsReachabilityPopulationBound,
} from './birdsPopulationBounds';

const commandLine = globalThis as unknown as {
  readonly process?: { readonly argv: readonly string[] };
};
const maximumEpoch = Number(commandLine.process?.argv[2] ?? 12);
const populationDensity = Number(commandLine.process?.argv[3] ?? 2);
const diffusionArguments = commandLine.process?.argv.slice(4) ?? [];
const diffusionRates = diffusionArguments.length === 0 ? [0, 0.5, 1, 2, 4] : diffusionArguments.map(Number);
const rows = diffusionRates.flatMap((diffusionRate) =>
  Array.from({ length: maximumEpoch + 1 }, (_, epoch) => {
    const bound = deriveBirdsPopulationBound({ diffusionRate, epoch, populationDensity });
    return {
      diffusionRate,
      epoch,
      cellWidth: bound.scaleCellWidth,
      wholeDurationOffsets: bound.wholeDurationOffsetCount,
      halfDurationOffsets: bound.halfDurationOffsetCount,
      firstMidpointFanIn: bound.firstMidpointFanIn,
      quarterMidpointFanIn: bound.quarterMidpointFanIn,
      epochConcentrationFactor: bound.epochConcentrationFactor.toString(),
      maximumCellPopulation: bound.maximumCellPopulation.toString(),
      exceedsSafeInteger: bound.maximumCellPopulation > BigInt(Number.MAX_SAFE_INTEGER),
      exactReachabilityCapacity:
        epoch <= 3
          ? deriveBirdsReachabilityPopulationBound({
              diffusionRate,
              epoch,
              populationDensity,
            }).maximumCellPopulation.toString()
          : '',
    };
  }),
);

const columns = Object.keys(rows[0]) as Array<keyof (typeof rows)[number]>;
console.log(columns.join('\t'));
for (const row of rows) console.log(columns.map((column) => String(row[column])).join('\t'));
