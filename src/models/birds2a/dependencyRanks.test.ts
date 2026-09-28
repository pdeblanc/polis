import { describe, expect, it } from 'vitest';
import { Birds2aEngine } from './birds2aEngine';
import { birds2aDependencyBounds, birds2aDependencyRank,
  type Birds2aDependencyBounds, type Birds2aQueryNode } from './dependencyRanks';
import { classifyBirds2aCell, classifyBirds2aFlow, type Birds2aCell } from './classifiers';

const cell = (width: number, time: number, index = 0): Birds2aCell =>
  ({ min: index * width, max: (index + 1) * width, time });

describe('Birds 2a dependency ranks', () => {
  it('makes every coarse-ceiling fact an expansion terminal throughout the closed time window', () => {
    for (const origin of [{ min: 0, max: 1 }, { min: -2, max: -1 }, { min: 0.25, max: 0.5 }]) {
      for (const factor of [2, 4, 16]) {
        const width = factor * (origin.max - origin.min), duration = width ** 2;
        const bounds = birds2aDependencyBounds({ role: 'cell', cell: cell(width, duration) }, origin);
        expect(bounds).toEqual({ ceilingWidth: width, timeRadius: duration });
        for (let slot = -4; slot <= 4; slot++) for (const index of [-19, 0, 31]) {
          const c = cell(width, slot * duration / 4, index);
          expect(classifyBirds2aCell(c, origin)?.kind).toBe('expansion');
          expect(birds2aDependencyRank({ role: 'cell', cell: c }, origin, bounds)).toBe(0);
        }
        for (const [sw, dw, dt] of [[width, width, duration], [width, width, duration / 2],
          [width, width, duration / 4], [width / 2, width, duration / 4], [width, width / 2, duration / 4]]) {
          for (let start = -duration; start + dt <= duration; start += dt) {
            const flow = { source: cell(sw, start, -3), destination: cell(dw, start + dt, 7) };
            expect(classifyBirds2aFlow(flow, origin)?.kind).toBe('expansion');
            expect(birds2aDependencyRank({ role: 'flow', flow }, origin, bounds)).toBe(0);
          }
        }
      }
    }
  });

  for (const diffusion of [0, 0.5, 2]) it(`decreases along actual cold and warm engine edges at diffusion ${diffusion}`, () => {
    const origin = { min: -1, max: 0 };
    let bounds: Birds2aDependencyBounds;
    let edges = 0;
    const roles = new Set<string>();
    const engine = new Birds2aEngine('rank-edges', 24, diffusion, origin, ({ dependent, dependency }) => {
      const from = birds2aDependencyRank(dependent, origin, bounds);
      const to = birds2aDependencyRank(dependency, origin, bounds);
      if (from === undefined || to === undefined || !Number.isSafeInteger(to) || to < 0 || to >= from) {
        throw new Error(`Nondecreasing dependency: ${JSON.stringify({ from, to, dependent, dependency })}`);
      }
      roles.add(dependency.role); roles.add(dependent.role); edges++;
    });
    const roots: Birds2aQueryNode[] = [];
    for (const width of [0.5, 1, 2]) for (const slot of [-5, -1, 0, 1, 5]) {
      roots.push({ role: 'cell', cell: cell(width, slot * width ** 2 / 4, -1) });
      for (const ratio of [1, 0.5, 0.25]) {
        const duration = ratio * width ** 2, start = slot * duration;
        roots.push({ role: 'flow', flow: { source: cell(width, start, -1), destination: cell(width, start + duration) } });
      }
    }
    const run = (root: Birds2aQueryNode) => {
      bounds = birds2aDependencyBounds(root, origin);
      expect(birds2aDependencyRank(root, origin, bounds)).toBeGreaterThanOrEqual(0);
      return root.role === 'cell' ? engine.queryCell(root.cell) : engine.queryFlow(root.flow);
    };
    const expected = roots.map(run);
    engine.clearCache();
    roots.forEach((root, i) => expect(run(root)).toBe(expected[i]));
    roots.forEach((root, i) => expect(run(root)).toBe(expected[i]));
    expect(edges).toBeGreaterThan(100);
    expect(roles).toEqual(new Set(['cell', 'flow', 'cell-subdivision', 'temporal-subdivision',
      'outflow-subdivision', 'inflow-subdivision', 'flow-space-subdivision']));
  });

  it('covers widely separated origin/query scales and distant times without imposing a fixed ceiling', () => {
    for (const origin of [{ min: 0, max: 1 }, { min: -4, max: -2 }, { min: 0.25, max: 0.5 }]) {
      let bounds: Birds2aDependencyBounds;
      let edges = 0;
      const engine = new Birds2aEngine('deep-ranks', 16, 0, origin, ({ dependent, dependency }) => {
        expect(birds2aDependencyRank(dependency, origin, bounds)!)
          .toBeLessThan(birds2aDependencyRank(dependent, origin, bounds)!);
        edges++;
      });
      for (const exponent of [-24, -8, 0, 4]) for (const time of [0, -1024, 1024]) {
        const width = 2 ** exponent;
        const root: Birds2aQueryNode = { role: 'cell', cell: cell(width, time, Math.floor(origin.min / width)) };
        bounds = birds2aDependencyBounds(root, origin);
        engine.queryCell(root.cell);
      }
      expect(edges).toBeGreaterThan(0);
    }
  });

  it('restores diagnostic ancestry after an observer error', () => {
    let fail = true, calls = 0;
    const origin = { min: 0, max: 1 };
    const root: Birds2aQueryNode = { role: 'cell', cell: cell(0.25, 0.0625) };
    const bounds = birds2aDependencyBounds(root, origin);
    const engine = new Birds2aEngine('observer-recovery', 16, 0, origin, ({ dependent, dependency }) => {
      if (fail) throw new Error('Diagnostic failure');
      expect(birds2aDependencyRank(dependency, origin, bounds)!).toBeLessThan(birds2aDependencyRank(dependent, origin, bounds)!);
      calls++;
    });
    expect(() => engine.queryCell(root.cell)).toThrow('Diagnostic failure');
    fail = false;
    expect(engine.queryCell(root.cell)).toBe(new Birds2aEngine('observer-recovery', 16, 0, origin).queryCell(root.cell));
    expect(calls).toBeGreaterThan(0);
  });
});
