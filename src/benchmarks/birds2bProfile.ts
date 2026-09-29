/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { Session } from 'node:inspector/promises';
import type { Profiler } from 'node:inspector';
import { fileURLToPath } from 'node:url';
import { Birds2bEngine } from '../models/birds2b/birds2bEngine';
import { CompositeEngine } from '../models/birds2b/compositeEngine';
import type { CompositeCell } from '../models/birds2b/compositeClassifiers';

// No production instrumentation. Each bounded subprocess profiles model queries
// only, excluding module loading, constructors, rendering and console output.
const cases = [
  { width: 1, time: 0 },
  { width: 0.25, time: 0 },
  { width: 4, time: 0 },
  { width: 0.25, time: 6 },
] as const;
const args = process.argv.slice(2);
if (args[0] === '--worker') {
  const index = Number(args[1]), profileCase = cases[index];
  if (!profileCase) throw new Error('Unknown profile case');
  const cells: CompositeCell[] = [];
  for (let row = -12; row <= 12; row++) for (let column = -12; column < 12; column++) {
    cells.push({ min: column * profileCase.width, max: (column + 1) * profileCase.width,
      time: profileCase.time + row * profileCase.width ** 2 / 4 });
  }
  const run = async (profiled: boolean) => {
    const source = new Birds2bEngine('Polis 5', 2, 0.5);
    let boundaryMs = 0, cellReads = 0, flowReads = 0;
    const model = new CompositeEngine('Polis 5', 0.5, profiled ? {
      queryCell(cell) {
        cellReads++; const start = performance.now();
        try { return source.queryCell(cell); } finally { boundaryMs += performance.now() - start; }
      },
      queryFlow(flow) {
        flowReads++; const start = performance.now();
        try { return source.queryFlow(flow); } finally { boundaryMs += performance.now() - start; }
      },
    } : source);
    const session = new Session();
    if (profiled) {
      session.connect();
      await session.post('Profiler.enable');
      await session.post('Profiler.setSamplingInterval', { interval: 500 });
      await session.post('Profiler.start');
    }
    const start = performance.now();
    const counts = cells.map((cell) => model.queryCell(cell));
    const elapsedMs = performance.now() - start;
    let profile: Profiler.Profile | undefined;
    if (profiled) {
      profile = (await session.post('Profiler.stop')).profile;
      session.disconnect();
    }
    const warmStart = performance.now();
    cells.forEach((cell, i) => { if (model.queryCell(cell) !== counts[i]) throw new Error('Replay differs'); });
    return { elapsedMs, warmMs: performance.now() - warmStart, counts, boundaryMs, cellReads, flowReads,
      channels: source.getChannelUsage(), profile };
  };
  await run(false); // JIT warm-up on a disposable model, not the measured caches.
  const baseline = await run(false), measured = await run(true);
  if (baseline.counts.some((count, i) => count !== measured.counts[i])) throw new Error('Profiling changed results');
  console.log(JSON.stringify({ case: profileCase, cells: cells.length, baselineMs: baseline.elapsedMs,
    profiledMs: measured.elapsedMs, warmMs: baseline.warmMs, boundaryMs: measured.boundaryMs,
    boundaryPercent: 100 * measured.boundaryMs / measured.elapsedMs,
    boundaryCellReads: measured.cellReads, boundaryFlowReads: measured.flowReads,
    channels: measured.channels, ...summarize(measured.profile!) }));
} else {
  if (args.length) throw new Error('No profile options supported');
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    seed: 'Polis 5', density: 2, diffusion: 0.5, samplingIntervalUs: 500, timeoutMs: 30000 }));
  for (let index = 0; index < cases.length; index++) {
    try {
      process.stdout.write(execFileSync(process.execPath,
        ['--import', 'tsx', fileURLToPath(import.meta.url), '--worker', String(index)],
        { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }));
    } catch (error) {
      const failure = error as { code?: string; stdout?: string; message?: string };
      if (failure.stdout) process.stdout.write(failure.stdout);
      console.log(JSON.stringify({ case: cases[index], status: failure.code === 'ETIMEDOUT' ? 'timeout' : 'error',
        message: failure.message }));
      process.exitCode = 1;
    }
  }
}

function summarize(profile: Profiler.Profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const buckets = new Map<string, number>(), functions = new Map<string, number>();
  let total = 0, excludedInspectorUs = 0, samples = 0;
  for (const [i, id] of (profile.samples ?? []).entries()) {
    const weight = profile.timeDeltas?.[i] ?? 1;
    const node = nodes.get(id)!;
    const frame = node.callFrame;
    // Starting/stopping the inspector can itself occupy tens of milliseconds.
    // Exclude its samples rather than attributing profiler setup to model work.
    if (frame.url.startsWith('node:inspector')) { excludedInspectorUs += weight; continue; }
    total += weight; samples++;
    const name = `${frame.functionName || '(anonymous)'} @ ${frame.url.split('/').slice(-2).join('/')}:${frame.lineNumber + 1}`;
    functions.set(name, (functions.get(name) ?? 0) + weight);
    let category: string | undefined, cursor: number | undefined = id;
    // Deepest recognized frame owns the sample: hash time is not counted again
    // under its calling distribution, nor is classifier time counted as support.
    while (cursor !== undefined && !category) {
      const current = nodes.get(cursor)!.callFrame, url = current.url, fn = current.functionName;
      if (fn === '(garbage collector)') category = 'GC';
      else if (/rapidhash|addressedRandom/.test(url)) category = 'hashing/RNG';
      else if (/utils\/rng\/address\./.test(url)) category = 'address encoding';
      else if (/utils\/distributions\/|@stdlib/.test(url)) category = 'distributions (excluding RNG)';
      else if (/quick-lru/.test(url)) category = 'cache operations';
      else if (/classifiers|Classifiers/.test(url)) category = 'classifiers';
      else if (/motionSupport|MotionSupport|populationSupport|\/channels\./.test(url)) category = 'support/geometry';
      else if (/Key$/.test(fn)) category = 'cache key construction';
      cursor = parents.get(cursor);
    }
    category ??= 'other';
    buckets.set(category, (buckets.get(category) ?? 0) + weight);
  }
  const percentages = (entries: Map<string, number>) => [...entries].sort((a, b) => b[1] - a[1])
    .map(([name, weight]) => ({ name, percent: Math.round(1000 * weight / total) / 10 }));
  return { samples, excludedInspectorMs: excludedInspectorUs / 1000, sampledMs: total / 1000,
    breakdown: percentages(buckets), topSelf: percentages(functions).slice(0, 16) };
}
