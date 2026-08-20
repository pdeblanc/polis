import { describe, expect, it } from "vitest";
import { Birds } from "../models/birds/birds";
import { Sighting, SightingBudgetExceededError } from "./birdsSighting";

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
