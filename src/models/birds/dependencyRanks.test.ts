import { describe, expect, it } from 'vitest';
import {
  BirdsEngine,
  type BirdsDependencyEdge,
  type BirdsDependencyNode,
} from './birdsEngine';
import { birdsDependencyRank, compareBirdsDependencyRanks } from './dependencyRanks';
import type { BirdCell } from './entities';
import { possibleFlowDestinations } from './motionSupport';
import { birdsScale } from './scales';

const DIFFUSION_RATE = 0.5;

function cell(epoch: number, spatialIndex: number, time: number): BirdCell {
  const length = birdsScale(epoch)!.cellLength;
  return { min: spatialIndex * length, max: (spatialIndex + 1) * length, time };
}

describe('Birds dependency tracing and conceptual ranks', () => {
  it('assigns every observed recursive edge a strictly decreasing rank', () => {
    const edges: BirdsDependencyEdge[] = [];
    const engine = new BirdsEngine('dependency-ranks', 2, DIFFUSION_RATE, {
      observeDependency: (edge) => edges.push(edge),
    });

    for (const epoch of [0, 1, 2, 3]) {
      const scale = birdsScale(epoch)!;
      const samples = [
        [-5, -3],
        [-1, 0],
        [4, 2],
      ] as const;
      for (const [spatialIndex, timeIndex] of epoch === 3 ? samples.slice(1, 2) : samples) {
        const source = cell(epoch, spatialIndex, timeIndex * scale.flowDuration);
        const destinations = possibleFlowDestinations(
          source,
          scale.flowDuration,
          DIFFUSION_RATE,
        );
        const destination = destinations[(spatialIndex + timeIndex + destinations.length * 2) % destinations.length];
        engine.clearCache();
        engine.queryFlow({ source, destination });
        engine.clearCache();
        engine.queryCell(source);
      }
    }

    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      const dependentRank = birdsDependencyRank(edge.dependent);
      const dependencyRank = birdsDependencyRank(edge.dependency);
      expect(dependentRank, describeNode(edge.dependent)).toBeDefined();
      expect(dependencyRank, describeNode(edge.dependency)).toBeDefined();
      expect(
        compareBirdsDependencyRanks(dependencyRank!, dependentRank!),
        `${describeNode(edge.dependent)} -> ${describeNode(edge.dependency)}`,
      ).toBeLessThan(0);
    }

    expect(new Set(edges.flatMap(({ dependent, dependency }) => [dependent.role, dependency.role])))
      .toEqual(
        new Set([
          'cell',
          'flow',
          'two-stage-flow',
          'temporal-subdivision',
          'cell-subdivision',
          'outflow-subdivision',
          'inflow-subdivision',
          'flow-space-subdivision',
        ]),
      );
  });
});

function describeNode(node: BirdsDependencyNode): string {
  return node.role;
}
