import type { ExpansionMeasurementQuery as Query, ExpansionMeasurementStage as Stage,
  ExpansionObservationCell as Cell } from './birds2ExpansionManifest';

// Fixed observation windows, not derived from model parameters or motion support.
const WINDOWS = [
  { id: 'origin', start: 0, width: 1 },
  { id: 'later', start: 4, width: 2 },
] as const;
const INDICES = [-1, 0, 1] as const;
const OFFSETS = [-2, -1, 0, 1, 2] as const;
const MIDPOINT_OFFSETS = [-1, 0, 1] as const;
const STAGES = ['A', 'B', 'C', 'D', 'E', 'F', 'G1', 'G2', 'H'] as const;

export const birds2RefinementStages: readonly Stage[] = WINDOWS.flatMap((window) =>
  [0, 1, 2].flatMap((level) => {
    const width = window.width / 2 ** level, duration = width ** 2;
    return (['forward', 'backward'] as const).flatMap((branch) => {
      // Construct chronological A–H facts, then represent their endpoints in
      // outward order just like expansion measurements. G1/G2 retain their
      // chronological source/destination meaning on the negative branch.
      const start = branch === 'forward' ? window.start : -window.start - duration;
      const cell = (w: number, index: number, time: number): Cell =>
        ({ min: index === 0 ? 0 : index * w, max: (index + 1) * w, time });
      const flow = (id: string, source: Cell, destination: Cell): Query =>
        ({ id, kind: 'flow', from: branch === 'forward' ? source : destination,
          to: branch === 'forward' ? destination : source });
      const split = (id: string, source: Cell, via: Cell, destination: Cell): Query =>
        ({ id, kind: 'temporal-split', from: branch === 'forward' ? source : destination, via,
          to: branch === 'forward' ? destination : source });
      const descriptions = {
        A: 'Three-time allocations of full-duration flows through their midpoint.',
        B: 'Both half-duration leg counts after summing A allocations over the other endpoint.',
        C: 'Three-time allocations of both half-duration flows through their quarter-time midpoints.',
        D: 'All four quarter-duration leg counts after summing C allocations.',
        E: 'Coarse-cell populations at the three interior quarter-time frames.',
        F: 'Both spatial child populations at each interior frame.',
        G1: 'Source-child to coarse-destination flow margins for every quarter-time step.',
        G2: 'Coarse-source to destination-child flow margins for every quarter-time step.',
        H: 'All four child-pair flow counts after reconciling the G1 and G2 margins.',
      };
      const queries = Object.fromEntries(STAGES.map((stage) => [stage, [] as Query[]])) as Record<typeof STAGES[number], Query[]>;
      for (const stage of ['A', 'C'] as const) {
        const parts = stage === 'A' ? 1 : 2, step = duration / parts;
        for (let part = 0; part < parts; part++) for (const i of INDICES) for (const d of OFFSETS) {
          for (const r of MIDPOINT_OFFSETS) {
            queries[stage].push(split(`part-${part}/source-${i}/offset-${d}/midpoint-${r}`,
              cell(width, i, start + part * step),
              cell(width, i + Math.floor(d / 2) + r, start + (part + 0.5) * step),
              cell(width, i + d, start + (part + 1) * step)));
          }
        }
      }
      for (const stage of ['B', 'D'] as const) {
        const parts = stage === 'B' ? 2 : 4, step = duration / parts;
        for (let part = 0; part < parts; part++) for (const i of INDICES) for (const d of OFFSETS) {
          queries[stage].push(flow(`part-${part}/source-${i}/offset-${d}`,
            cell(width, i, start + part * step), cell(width, i + d, start + (part + 1) * step)));
        }
      }
      for (const part of [1, 2, 3]) for (const i of INDICES) {
        const time = start + part * duration / 4;
        queries.E.push({ id: `frame-${part}/cell-${i}`, kind: 'population', cell: cell(width, i, time) });
        for (const child of [0, 1]) queries.F.push({
          id: `frame-${part}/cell-${i}/child-${child}`, kind: 'population', cell: cell(width / 2, 2 * i + child, time),
        });
      }
      for (const part of [0, 1, 2, 3]) for (const i of INDICES) for (const d of OFFSETS) {
        const from = start + part * duration / 4, to = start + (part + 1) * duration / 4;
        const id = `part-${part}/source-${i}/offset-${d}`;
        for (const child of [0, 1]) {
          queries.G1.push(flow(`${id}/child-${child}`,
            cell(width / 2, 2 * i + child, from), cell(width, i + d, to)));
          queries.G2.push(flow(`${id}/child-${child}`,
            cell(width, i, from), cell(width / 2, 2 * (i + d) + child, to)));
          for (const other of [0, 1]) queries.H.push(flow(`${id}/source-child-${child}/destination-child-${other}`,
            cell(width / 2, 2 * i + child, from), cell(width / 2, 2 * (i + d) + other, to)));
        }
      }
      return STAGES.map((stage): Stage => ({
        id: `refinement.${window.id}.level-${level}.${branch}.${stage}`,
        title: `Stage ${stage} ${window.id} refinement level ${level} ${branch}`,
        description: descriptions[stage],
        branch,
        refinement: { stage, level, parentWidth: width, startTime: start, endTime: start + duration },
        record: stage === 'A' || stage === 'C' ? 'queryTemporalSplit'
          : stage === 'E' || stage === 'F' ? 'queryCell' : 'queryFlow',
        queries: queries[stage],
      }));
    });
  }));
