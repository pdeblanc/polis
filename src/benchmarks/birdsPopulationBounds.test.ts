import { describe, expect, it } from 'vitest';
import {
  deriveBirdsPopulationBound,
  deriveBirdsReachabilityPopulationBound,
} from './birdsPopulationBounds';

describe('Birds deterministic population bound', () => {
  it('includes hierarchy-closed temporal fan-in even at zero diffusion', () => {
    const result = deriveBirdsPopulationBound({
      diffusionRate: 0,
      epoch: 12,
      populationDensity: 2,
    });

    expect(result.firstMidpointFanIn).toBeGreaterThan(1);
    expect(result.quarterMidpointFanIn).toBeGreaterThan(1);
    expect(result.epochConcentrationFactor).toBe(
      BigInt(result.firstMidpointFanIn * result.quarterMidpointFanIn),
    );
    expect(result.maximumCellPopulation).toBe(
      result.coarsePopulation * result.epochConcentrationFactor ** 12n,
    );
  });

  it('compounds both temporal midpoint fan-in factors once per epoch', () => {
    const first = deriveBirdsPopulationBound({
      diffusionRate: 1,
      epoch: 1,
      populationDensity: 1,
    });
    const third = deriveBirdsPopulationBound({
      diffusionRate: 1,
      epoch: 3,
      populationDensity: 1,
    });

    expect(first.epochConcentrationFactor).toBeGreaterThan(1n);
    expect(third.maximumCellPopulation).toBe(
      third.coarsePopulation * third.epochConcentrationFactor ** 3n,
    );
    expect(third.epochConcentrationFactor).toBe(first.epochConcentrationFactor);
  });

  it('charges conserved coarse-flow capacities only once', () => {
    const zeroDiffusion = deriveBirdsReachabilityPopulationBound({
      diffusionRate: 0,
      epoch: 3,
      populationDensity: 2,
    });
    const moving = deriveBirdsReachabilityPopulationBound({
      diffusionRate: 1,
      epoch: 2,
      populationDensity: 2,
    });

    expect(zeroDiffusion.maximumCellPopulation).toBe(34n);
    expect(moving.maximumCellPopulation).toBeGreaterThanOrEqual(32n);
    expect(moving.maximumCellPopulation).toBeLessThan(
      deriveBirdsPopulationBound({
        diffusionRate: 1,
        epoch: 2,
        populationDensity: 2,
      }).maximumCellPopulation,
    );
  });
});
