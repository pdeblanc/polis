import { describe, expect, it } from 'vitest';
import {
  classifyBirds2aCell, classifyBirds2aCellSubdivision, classifyBirds2aFlow,
  type Birds2aCell, type Birds2aFlow,
} from './classifiers';
import {
  classifyBirds2aFlowSpaceSubdivision, classifyBirds2aFlowTimeSubdivision,
  classifyBirds2aInflowSubdivision, classifyBirds2aOutflowSubdivision,
} from './ownerClassifiers';
import type { ExpansionCell } from './expansion';

const origin = { min: 0, max: 1 };
const cell = (width: number, time: number, index = 0): Birds2aCell =>
  ({ min: index * width, max: (index + 1) * width, time });
const flow = (width: number, start: number, end: number): Birds2aFlow =>
  ({ source: cell(width, start), destination: cell(width, end) });

describe('Birds 2a batch owners', () => {
  it('distinguishes bypassed temporal legs from new multinomial allocations', () => {
    for (const sign of [-1, 1]) {
      const chronological = (a: number, b: number) => flow(2, Math.min(sign * a, sign * b), Math.max(sign * a, sign * b));
      for (const [a, b] of [[0, 4], [0, 2], [2, 4]]) {
        expect(() => classifyBirds2aFlowTimeSubdivision(chronological(a, b), origin))
          .toThrow('expansion supplies both legs');
      }
    }
    expect(classifyBirds2aFlowTimeSubdivision(flow(1, 0, 1), origin))
      .toMatchObject({ kind: 'multinomial', stage: 'A', normalizedDuration: 1, midpointTime: 0.5 });
    expect(classifyBirds2aFlowTimeSubdivision(flow(1, 0, 0.5), origin))
      .toMatchObject({ kind: 'multinomial', stage: 'C', normalizedDuration: 0.5 });
  });

  it('uses retained child flows for G/H even when their parent is an expansion fact', () => {
    for (const time of [-4, -3, -2, -1, 0, 1, 2, 3]) {
      const parent = flow(2, time, time + 1);
      const owner = classifyBirds2aFlowSpaceSubdivision(parent, origin)!;
      expect(owner.kind).toBe('expansion');
      for (const entry of [...owner.childFlows, ...owner.sourceMargins, ...owner.destinationMargins]) {
        expect(classifyBirds2aFlow(entry, origin)?.kind).toBe('expansion');
      }
      expect(classifyBirds2aOutflowSubdivision(parent.source, origin)?.kind).toBe('expansion');
      expect(classifyBirds2aInflowSubdivision(parent.destination, origin)?.kind).toBe('expansion');
    }
    expect(classifyBirds2aFlowSpaceSubdivision(flow(1, 0, 0.25), origin)?.kind).toBe('hypergeometric');
    expect(classifyBirds2aOutflowSubdivision(cell(1, 0), origin)?.kind).toBe('hypergeometric');
    expect(classifyBirds2aInflowSubdivision(cell(1, 0), origin)?.kind).toBe('hypergeometric');
  });

  it('rejects invalid owner domains', () => {
    for (const bad of [flow(1, 0, 0.25), flow(1, 0.25, 1.25), flow(1, 1, 0),
      { source: cell(1, 0), destination: cell(2, 1) }]) {
      expect(classifyBirds2aFlowTimeSubdivision(bad, origin)).toBeUndefined();
    }
    for (const bad of [flow(1, 0, 1), flow(1, 0, 0.5), flow(1, 0.125, 0.375)]) {
      expect(classifyBirds2aFlowSpaceSubdivision(bad, origin)).toBeUndefined();
    }
    expect(classifyBirds2aOutflowSubdivision(cell(1, 0.1), origin)).toBeUndefined();
    expect(classifyBirds2aInflowSubdivision(cell(3, 0), origin)).toBeUndefined();
  });

  it('classifies entire spatial batches uniformly and never partially replaces temporal legs', () => {
    for (const origin of [{ min: 0, max: 1 }, { min: -4, max: -2 }, { min: 0.25, max: 0.5 }]) {
      for (const width of [0.25, 0.5, 1, 2, 4, 8]) for (let slot = -17; slot <= 17; slot++) {
        const time = slot * width ** 2 / 4;
        const parent = flow(width, time, time + width ** 2 / 4);
        const space = classifyBirds2aFlowSpaceSubdivision(parent, origin)!;
        for (const entry of space.childFlows) {
          expect(classifyBirds2aFlow(entry, origin)?.kind === 'expansion').toBe(space.kind === 'expansion');
        }
        for (const owner of [classifyBirds2aOutflowSubdivision(parent.source, origin)!,
          classifyBirds2aInflowSubdivision(parent.destination, origin)!]) {
          for (const child of owner.children) for (const index of [-9, 0, 7]) {
            const opposite = cell(owner.oppositeCellWidth, owner.oppositeTime, index);
            const entry = owner.stage === 'G1' ? { source: child, destination: opposite } : { source: opposite, destination: child };
            expect(classifyBirds2aFlow(entry, origin)?.kind === 'expansion').toBe(owner.kind === 'expansion');
          }
        }
        for (const duration of [width ** 2, width ** 2 / 2]) {
          const start = slot * duration, end = start + duration;
          const mid = cell(width, start + duration / 2, -3);
          const first = classifyBirds2aFlow({ source: cell(width, start, 5), destination: mid }, origin)!;
          const second = classifyBirds2aFlow({ source: mid, destination: cell(width, end, -7) }, origin)!;
          expect(first.kind === 'expansion').toBe(second.kind === 'expansion');
          if (first.kind === 'expansion') {
            expect(() => classifyBirds2aFlowTimeSubdivision(flow(width, start, end), origin)).toThrow('expansion supplies both legs');
          } else expect(classifyBirds2aFlowTimeSubdivision(flow(width, start, end), origin)?.kind).toBe('multinomial');
        }
      }
    }
  });
});

type Node = { role: 'cell' | 'F' | 'G1' | 'G2'; cell: Birds2aCell }
  | { role: 'flow' | 'time' | 'H'; flow: Birds2aFlow };

/** Explore the dependency shapes, not motion-support enumeration. Spatial indices
 * do not affect expansion coverage or recursion shape, so one representative of
 * each width/time suffices for otherwise arbitrarily many possible endpoints. */
function ancestry(origin: ExpansionCell) {
  const active = new Set<string>(), completed = new Map<string, number>();
  const kinds = new Set<string>();
  let terminals = 0;
  function visit(node: Node): number {
    const key = JSON.stringify(node);
    if (active.has(key)) throw new Error(`Dependency cycle: ${key}`);
    if (completed.has(key)) return completed.get(key)!;
    if (active.size > 256) throw new Error(`Ancestry did not terminate: ${key}`);
    active.add(key);
    const dependencies: Node[] = [];
    if ('cell' in node) {
      const c = node.cell;
      if (node.role === 'cell') {
        const construction = classifyBirds2aCell(c, origin)!;
        expect(construction).toBeDefined(); kinds.add(construction.kind);
        if (construction.kind === 'spatial-child') dependencies.push({ role: 'F', cell: construction.subdivisionOwner });
        else if (construction.kind === 'temporal-aggregation') dependencies.push({ role: 'flow',
          flow: { source: c, destination: cell(c.max - c.min, c.time + construction.outgoingDuration) } });
      } else if (node.role === 'F') {
        const owner = classifyBirds2aCellSubdivision(c, origin)!;
        expect(owner).toBeDefined(); kinds.add(owner.kind);
        if (owner.kind === 'binomial') dependencies.push({ role: 'cell', cell: c });
      } else {
        const owner = (node.role === 'G1' ? classifyBirds2aOutflowSubdivision : classifyBirds2aInflowSubdivision)(c, origin)!;
        expect(owner).toBeDefined(); kinds.add(owner.kind);
        if (owner.kind === 'hypergeometric') {
          const opposite = cell(owner.oppositeCellWidth, owner.oppositeTime);
          dependencies.push({ role: 'F', cell: c }, { role: 'flow', flow: owner.stage === 'G1'
            ? { source: c, destination: opposite } : { source: opposite, destination: c } });
        }
      }
    } else {
      const f = node.flow;
      if (node.role === 'flow') {
        const construction = classifyBirds2aFlow(f, origin)!;
        expect(construction).toBeDefined(); kinds.add(construction.kind);
        switch (construction.kind) {
          case 'expansion': break;
          case 'spatial-reconciliation': dependencies.push({ role: 'H', flow: construction.subdivisionOwner }); break;
          case 'source-subdivision': dependencies.push({ role: 'G1', cell: construction.subdivisionOwner }); break;
          case 'destination-subdivision': dependencies.push({ role: 'G2', cell: construction.subdivisionOwner }); break;
          case 'temporal-aggregation': dependencies.push({ role: 'time', flow: {
            source: construction.leg === 'first' ? f.source : cell(f.source.max - f.source.min, construction.enclosingStartTime),
            destination: construction.leg === 'second' ? f.destination : cell(f.destination.max - f.destination.min, construction.enclosingEndTime),
          } }); break;
        }
      } else if (node.role === 'time') {
        const owner = classifyBirds2aFlowTimeSubdivision(f, origin)!;
        expect(owner).toBeDefined();
        // A reachable leg must never request a joint allocation for retained legs.
        expect(owner.kind).toBe('multinomial'); kinds.add(owner.stage);
        dependencies.push({ role: 'flow', flow: owner.ownerFlow });
      } else {
        const owner = classifyBirds2aFlowSpaceSubdivision(f, origin)!;
        expect(owner).toBeDefined(); kinds.add(owner.kind);
        if (owner.kind === 'hypergeometric') dependencies.push({ role: 'flow', flow: f },
          ...[...owner.sourceMargins, ...owner.destinationMargins].map((flow): Node => ({ role: 'flow', flow })));
      }
    }
    if (!dependencies.length) terminals++;
    const depth = 1 + Math.max(0, ...dependencies.map(visit));
    active.delete(key); completed.set(key, depth);
    return depth;
  }
  return { visit, kinds, get terminals() { return terminals; } };
}

it('terminates sampled dependency shapes at expansion facts across scales and both time directions', () => {
  let state = 123456;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  for (const origin of [{ min: 0, max: 1 }, { min: -4, max: -2 }, { min: 0.25, max: 0.5 }]) {
    const graph = ancestry(origin);
    for (let i = 0; i < 180; i++) {
      const width = 2 ** (Math.floor(random() * 17) - 8);
      const time = (Math.floor(random() * 513) - 256) * width ** 2 / 4;
      expect(graph.visit({ role: 'cell', cell: cell(width, time) })).toBeLessThan(160);
      for (const ratio of [1, 0.5, 0.25]) {
        const duration = width ** 2 * ratio, start = Math.floor(time / duration) * duration;
        expect(graph.visit({ role: 'flow', flow: flow(width, start, start + duration) })).toBeLessThan(160);
      }
    }
    expect(graph.terminals).toBeGreaterThan(0);
    for (const kind of ['A', 'C', 'binomial', 'hypergeometric', 'spatial-reconciliation',
      'source-subdivision', 'destination-subdivision', 'expansion']) expect(graph.kinds.has(kind)).toBe(true);
  }
});
