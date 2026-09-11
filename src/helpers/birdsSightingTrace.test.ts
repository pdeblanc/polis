import { describe, expect, it } from 'vitest';
import { Birds, type BirdsCell, type BirdsPopulationResolution } from '../models/birds/birds';
import { Sighting, createSightingDiagnostics } from './birdsSighting';

/** A finite labeled reference, exposed to Sighting only as anonymous counts/flows.
 * This tests helper control flow, not the Birds hierarchy or Brownian fidelity.
 * Two endpoint co-occupancies require narrowing and shorter-time retries.
 */
function traceFixture() {
  // A synchronous traversal bug can bypass both query budgets and test timeouts.
  // Bound geometry reads so this regression fails rather than spinning forever.
  let widthReads = 0;
  const resolutions = [4, 2, 1].map((cellWidth) => Object.freeze({
    get cellWidth() {
      if (++widthReads > 100_000) throw new Error('Tracker did not make refinement progress');
      return cellWidth;
    },
    timeOrigin: 0 as const, timeStep: cellWidth ** 2,
  }));
  const positions = (time: number) => [0.25, [16, 32].includes(Math.abs(time)) ? 1.25 : 8.25];
  const labels = (cell: BirdsCell) => positions(cell.time).flatMap((x, label) =>
    x >= cell.min && x < cell.max ? [label] : []);
  const cellAt = (label: number, time: number, width: number): BirdsCell => {
    const min = Math.floor(positions(time)[label] / width) * width;
    return { min, max: min + width, time };
  };
  type Resolution = typeof resolutions[number];
  type FlowResolution = { sourceCellWidth: number; destinationCellWidth: number; duration: number; timeOrigin: 0; timeStep: number };
  const flowResolution = (sourceCellWidth: number, destinationCellWidth: number): FlowResolution => ({
    sourceCellWidth, destinationCellWidth, duration: Math.max(sourceCellWidth, destinationCellWidth) ** 2,
    timeOrigin: 0, timeStep: Math.max(sourceCellWidth, destinationCellWidth) ** 2,
  });
  const trace: { kind: 'flow' | 'refine' | 'coarsen'; cell: BirdsCell; labels: number[];
    endpoint?: BirdsCell; endpointCount?: number; width?: number }[] = [];
  const population = (cell: BirdsCell, resolution: Resolution) => ({ cell, resolution, count: labels(cell).length });
  const incidence = (cell: BirdsCell, direction: 1 | -1, resolution: FlowResolution) => {
    const width = direction === 1 ? resolution.destinationCellWidth : resolution.sourceCellWidth;
    const flows = labels(cell).map((label) => {
      const endpoint = cellAt(label, cell.time + direction * resolution.duration, width);
      trace.push({ kind: 'flow', cell, labels: labels(cell), endpoint, endpointCount: labels(endpoint).length });
      return { source: direction === 1 ? cell : endpoint, destination: direction === 1 ? endpoint : cell, count: 1 };
    });
    return { kind: 'flows' as const, resolution, flows };
  };
  const birds = {
    queryPopulationCell: ({ cell, resolution }: { cell: BirdsCell; resolution: Resolution }) => population(cell, resolution),
    refinePopulationResolution: (resolution: Resolution) => resolutions[resolutions.indexOf(resolution) + 1],
    refinePopulationCell: ({ cell, resolution }: { cell: BirdsCell; resolution: Resolution }) => {
      const fine = resolutions[resolutions.indexOf(resolution) + 1];
      if (!fine) throw new Error('Unexpected refinement below fixture precision');
      trace.push({ kind: 'refine', cell, labels: labels(cell), width: fine.cellWidth });
      return { resolution: fine, children: [0, 1].map((i) => population({
        min: cell.min + i * fine.cellWidth, max: cell.min + (i + 1) * fine.cellWidth, time: cell.time,
      }, fine)) };
    },
    coarsenPopulationCell: ({ cell, resolution }: { cell: BirdsCell; resolution: Resolution }) => {
      const parent = resolutions[resolutions.indexOf(resolution) - 1];
      if (!parent || cell.time % parent.timeStep !== 0) return undefined;
      const min = Math.floor(cell.min / parent.cellWidth) * parent.cellWidth;
      const entry = population({ min, max: min + parent.cellWidth, time: cell.time }, parent);
      trace.push({ kind: 'coarsen', cell: entry.cell, labels: labels(entry.cell), width: parent.cellWidth });
      return entry;
    },
    getNearbyPopulationResolutions: (resolution: Resolution) => {
      if (!resolutions.includes(resolution)) throw new Error('Foreign resolution');
      return [resolution];
    },
    resolveIncidentFlowResolution: ({ resolution }: { resolution: Resolution }) => flowResolution(resolution.cellWidth, resolution.cellWidth),
    queryIncidentFlows: ({ cell, direction, maximumDuration, resolution }: {
      cell: BirdsCell; direction: 'outgoing' | 'incoming'; maximumDuration: number; resolution: Resolution;
    }) => {
      const flow = flowResolution(resolution.cellWidth, resolution.cellWidth);
      if (flow.duration > maximumDuration) return { kind: 'duration-limit' as const, resolution: flow };
      return incidence(cell, direction === 'outgoing' ? 1 : -1, flow);
    },
    resolveFlowResolution: ({ targetSourceWidth, targetDestinationWidth, targetDuration }: {
      targetSourceWidth: number; targetDestinationWidth: number; targetDuration: number;
    }) => {
      const flow = flowResolution(targetSourceWidth, targetDestinationWidth);
      return flow.duration <= targetDuration ? flow : undefined;
    },
    queryOutflows: ({ source, resolution }: { source: BirdsCell; resolution: FlowResolution }) => incidence(source, 1, resolution),
    queryInflows: ({ destination, resolution }: { destination: BirdsCell; resolution: FlowResolution }) => incidence(destination, -1, resolution),
  } as unknown as Birds;
  return { birds, trace, labels, coarse: resolutions[0] as BirdsPopulationResolution,
    finest: resolutions[2] as BirdsPopulationResolution };
}

describe('Sighting multi-step singleton traces', () => {
  for (const direction of [1, -1] as const) it(`preserves commits and identity while refining/coarsening in direction ${direction}`, () => {
    const { birds, trace, labels, coarse, finest } = traceFixture();
    const start = Sighting.select({ birds, cell: { min: 0, max: 4, time: 0 }, resolution: coarse, seed: 'trace' });
    const committed = [start];
    const diagnostics = createSightingDiagnostics();
    let current = start;
    for (let step = 1; step <= 4; step++) {
      const traceStart = trace.length;
      const previousCells = committed.map((s) => ({ ...s.cell }));
      current = direction === 1 ? current.next({ diagnostics }) : current.prev({ diagnostics });
      expect(current.cell).toEqual({ min: 0, max: 4, time: direction * step * 16 });
      expect(current.resolution).toBe(coarse);
      const flows = trace.slice(traceStart).filter((e) => e.kind === 'flow');
      expect(flows.length).toBeGreaterThan(0);
      // Every actual continuation starts from the selected singleton; never a
      // rejected multi-population endpoint or a different exchangeable bird.
      let latestSource = (step - 1) * 16;
      for (const flow of flows) {
        expect(flow.labels).toEqual([0]);
        const sourceTime = direction * flow.cell.time;
        expect(sourceTime).toBeGreaterThanOrEqual(latestSource);
        expect(direction * flow.endpoint!.time).toBeGreaterThan(sourceTime);
        expect(direction * flow.endpoint!.time).toBeLessThanOrEqual(step * 16);
        latestSource = sourceTime;
      }
      // Public display cells may contain both birds. The retained tube must still
      // locate the original singleton after display coarsening and re-refinement.
      const isolated = current.rescale(finest);
      expect(labels(isolated.cell)).toEqual([0]);
      expect(isolated.rescale(coarse).rescale(finest).cell).toEqual(isolated.cell);
      expect(committed.map((s) => s.cell)).toEqual(previousCells);
      expect(committed.every(Object.isFrozen)).toBe(true);
      committed.push(current);
    }
    const flows = trace.filter((e) => e.kind === 'flow');
    const initial = flows.filter((e) => e.cell.time === 0);
    // Coarse collision, unsuccessful asymmetric narrowing, then source refinement.
    expect(initial.slice(0, 3).map((e) => [Math.abs(e.endpoint!.time), e.endpoint!.max - e.endpoint!.min, e.endpointCount]))
      .toEqual([[16, 4, 2], [16, 2, 2], [4, 2, 1]]);
    expect(diagnostics.spatialRefinements).toBeGreaterThan(0);
    expect(diagnostics.asymmetricNarrowingAttempts).toBeGreaterThan(0);
    expect(flows.some((e) => e.endpointCount === 1 && e.endpoint!.max - e.endpoint!.min === 1)).toBe(true);
    // Recovery to a width-2 singleton changes the next actual continuation, not
    // merely its presentation. Recovery to width 4 restores a single long step.
    expect(trace.some((e) => e.kind === 'coarsen' && e.cell.time === direction * 20 && e.width === 2 && e.labels.length === 1)).toBe(true);
    expect(flows.some((e) => e.cell.time === direction * 20 && e.cell.max - e.cell.min === 2)).toBe(true);
    expect(flows.filter((e) => e.cell.time === direction * 48)).toHaveLength(1);
    expect(flows.find((e) => e.cell.time === direction * 48)!.endpoint!.time).toBe(direction * 64);
  });
});
