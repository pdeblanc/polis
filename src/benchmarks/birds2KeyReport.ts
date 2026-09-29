/// <reference types="node" />
import type { BirdCell, BirdFlow } from '../models/birds/entities';

// Bounded key-generation + Map-lookup microbenchmark. Consume keys through a Map
// so V8 cannot measure only lazy string construction. Whole-query measurements
// are still required before adopting a variant.
const cellKey = (cell: BirdCell) => `${cell.min}:${cell.max}:${cell.time}`;
const variants: Record<string, (flow: BirdFlow) => string> = {
  nested: (flow) => `${cellKey(flow.source)}:${cellKey(flow.destination)}`,
  flat: ({ source: s, destination: d }) => `${s.min}:${s.max}:${s.time}:${d.min}:${d.max}:${d.time}`,
  join: ({ source: s, destination: d }) => [s.min, s.max, s.time, d.min, d.max, d.time].join(':'),
};
const flows: BirdFlow[] = [];
for (const width of [4, 1, 0.25, 2 ** -10, 2 ** -20]) {
  for (let row = -10; row < 10; row++) for (let column = -50; column < 50; column++) {
    const time = row * width ** 2 / 4;
    flows.push({ source: { min: column * width, max: (column + 1) * width, time },
      destination: { min: (column + 2) * width, max: (column + 3) * width, time: time + width ** 2 / 4 } });
  }
}
const expected = flows.map(variants.nested);
// Keys are consulted before validation: even invalid numeric input must retain
// its representation rather than aliasing a valid cached geometry.
for (const value of [-0, NaN, Infinity, -Infinity, Number.MIN_VALUE, Number.MAX_VALUE, 2 ** 53]) {
  for (const endpoint of ['source', 'destination'] as const) {
    for (const field of ['min', 'max', 'time'] as const) {
      const flow = { source: { min: 0, max: 1, time: 0 }, destination: { min: 1, max: 2, time: 1 } };
      flow[endpoint][field] = value;
      for (const key of Object.values(variants)) {
        if (key(flow) !== variants.nested(flow)) throw new Error('Boundary key mismatch');
      }
    }
  }
}
const lookup = new Map(expected.map((key, index) => [key, index]));
for (const key of Object.values(variants)) {
  if (flows.some((flow, index) => key(flow) !== expected[index])) throw new Error('Key mismatch');
}
const times: Record<string, number[]> = { nested: [], flat: [], join: [] };
let checksum = 0;
const names = Object.keys(variants);
for (let round = 0; round < 7; round++) {
  for (let i = 0; i < names.length; i++) {
    const name = names[(i + round) % names.length], key = variants[name];
    const start = performance.now();
    let sum = 0;
    for (let repeat = 0; repeat < 10; repeat++) for (const flow of flows) sum += lookup.get(key(flow))!;
    const elapsed = performance.now() - start;
    if (sum !== 10 * flows.length * (flows.length - 1) / 2) throw new Error('Lookup mismatch');
    checksum += sum;
    if (round >= 2) times[name].push(elapsed);
  }
}
console.log(JSON.stringify({ node: process.version, flows: flows.length, repetitions: 10, checksum }));
for (const [name, samples] of Object.entries(times)) {
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(JSON.stringify({ name, medianMs: sorted[Math.floor(sorted.length / 2)], samples }));
}
