import { describe, expect, it } from "vitest";
import {
  Birds,
  type BirdsPopulationResolution,
} from "../models/birds/birds";
import {
  createSightingDiagnostics,
  Sighting,
  SightingBudgetExceededError,
} from "./birdsSighting";

function coarseSighting(seed = "selection") {
  const birds = new Birds("sighting-model", 2, 0.5);
  const resolution = birds.resolvePopulationResolution({
    targetCellWidth: 16,
    targetTimeStep: 64,
  })!;
  const sighting = Sighting.select({
    birds,
    cell: { min: 0, max: 16, time: 0 },
    resolution,
    seed,
  });
  return { birds, resolution, sighting };
}

describe("Sighting selection and rescaling", () => {
  it("selects deterministically and transports the selected rank across scales", () => {
    const first = coarseSighting("same selection");
    const second = coarseSighting("same selection");
    const fine = first.birds.refinePopulationResolution(
      first.birds.refinePopulationResolution(first.resolution)!,
    )!;

    const firstFine = first.sighting.rescale(fine, { maxRefinements: 0 });
    const secondFine = second.sighting.rescale(
      second.birds.refinePopulationResolution(
        second.birds.refinePopulationResolution(second.resolution)!,
      )!,
    );
    const roundTrip = firstFine
      .rescale(first.resolution, { maxRefinements: 0 })
      .rescale(fine, { maxRefinements: 0 });

    expect(secondFine.cell).toEqual(firstFine.cell);
    expect(roundTrip.cell).toEqual(firstFine.cell);
    expect(first.sighting.cell).toEqual({ min: 0, max: 16, time: 0 });
    expect(first.sighting.resolution).toBe(first.resolution);
    expect(firstFine).not.toBe(first.sighting);
    expect(Object.isFrozen(first.sighting)).toBe(true);
    expect(Object.isFrozen(first.sighting.cell)).toBe(true);
  });

  it("rejects empty cells and resolutions from another model", () => {
    const emptyBirds = new Birds("empty-sighting", 0, 0.5);
    const emptyResolution = emptyBirds.resolvePopulationResolution({
      targetCellWidth: 16,
      targetTimeStep: 64,
    })!;
    expect(() =>
      Sighting.select({
        birds: emptyBirds,
        cell: { min: 0, max: 16, time: 0 },
        resolution: emptyResolution,
        seed: "none",
      }),
    ).toThrow(/empty cell/);

    const { sighting } = coarseSighting();
    expect(() => sighting.rescale(emptyResolution)).toThrow(/does not belong/);
  });

  it("reports explicit budget exhaustion without changing the original sighting", () => {
    const { sighting } = coarseSighting();
    const originalCell = sighting.cell;

    expect(() => sighting.next({ maxQueries: 1 })).toThrow(SightingBudgetExceededError);
    expect(sighting.cell).toBe(originalCell);

    const sparseBirds = new Birds("refinement-budget", 1 / 16, 0);
    const sparseResolution = sparseBirds.resolvePopulationResolution({
      targetCellWidth: 16,
      targetTimeStep: 64,
    })!;
    const sparse = Sighting.select({
      birds: sparseBirds,
      cell: { min: 0, max: 16, time: 0 },
      resolution: sparseResolution,
      seed: "only bird",
    });
    expect(() => sparse.next({ maxRefinements: 0 })).toThrow(/refinement budget/);
  });
});

describe("Sighting motion", () => {
  it("narrows the destination asymmetrically before refining the singleton source", () => {
    const coarse = Object.freeze({ cellWidth: 2, timeOrigin: 0 as const, timeStep: 4 });
    const fine = Object.freeze({ cellWidth: 1, timeOrigin: 0 as const, timeStep: 1 });
    const asymmetric = Object.freeze({
      sourceCellWidth: 2,
      destinationCellWidth: 1,
      duration: 4,
      timeOrigin: 0 as const,
      timeStep: 4,
    });
    let asymmetricQueries = 0;
    const diagnostics = createSightingDiagnostics();
    const birds = {
      queryPopulationCell: ({ cell }: { cell: { min: number; max: number; time: number } }) => ({
        cell,
        count: cell.time === 0 || cell.max - cell.min === 1 ? 1 : 2,
        resolution: cell.max - cell.min === 1 ? fine : coarse,
      }),
      queryIncidentFlows: () => ({
        kind: "flows" as const,
        resolution: asymmetric,
        flows: [{
          source: { min: 0, max: 2, time: 0 },
          destination: { min: 0, max: 2, time: 4 },
          count: 1,
        }],
      }),
      refinePopulationResolution: () => fine,
      resolveFlowResolution: () => asymmetric,
      queryOutflows: () => {
        asymmetricQueries += 1;
        return {
          kind: "flows" as const,
          resolution: asymmetric,
          flows: [{
            source: { min: 0, max: 2, time: 0 },
            destination: { min: 0, max: 1, time: 4 },
            count: 1,
          }],
        };
      },
      coarsenPopulationCell: ({ cell }: { cell: { time: number } }) => ({
        cell: { min: 0, max: 2, time: cell.time },
        count: 2,
        resolution: coarse,
      }),
      getNearbyPopulationResolutions: () => [coarse],
      refinePopulationCell: () => {
        throw new Error("the singleton source should not be refined");
      },
    } as unknown as Birds;

    const sighting = Sighting.select({
      birds,
      cell: { min: 0, max: 2, time: 0 },
      resolution: coarse as BirdsPopulationResolution,
      seed: "asymmetric narrowing",
    });
    const next = sighting.next({ diagnostics, maxRefinements: 0 });

    expect(asymmetricQueries).toBe(1);
    expect(diagnostics.asymmetricNarrowingAttempts).toBe(1);
    expect(diagnostics.spatialRefinements).toBe(0);
    expect(diagnostics.minimumFlowDuration).toBe(4);
    expect(next.cell).toEqual({ min: 0, max: 2, time: 4 });
    expect(next.resolution).toBe(coarse);
  });

  it("returns new sightings for the same bird in both time directions", () => {
    const birds = new Birds("motion-sighting", 1 / 16, 0);
    const resolution = birds.resolvePopulationResolution({
      targetCellWidth: 16,
      targetTimeStep: 64,
    })!;
    const sighting = Sighting.select({
      birds,
      cell: { min: 0, max: 16, time: 0 },
      resolution,
      seed: "only bird",
    });
    const next = sighting.next();
    const previous = next.prev();

    expect(next).not.toBe(sighting);
    expect(next.cell.time).toBe(sighting.cell.time + resolution.timeStep);
    expect(next.resolution).toBe(resolution);
    expect(previous.cell).toEqual(sighting.cell);
    expect(previous.resolution).toBe(resolution);
    expect(sighting.cell.time).toBe(0);
  });
});
