/// <reference types="node" />
import { createReadStream, closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { CalibrationMeasurementStage } from './birds2CalibrationManifest';
import type { CalibrationParameters } from './birds2CalibrationMeasurements';

interface Header {
  readonly type: 'manifest';
  readonly formatVersion: 1;
  readonly manifest: {
    readonly id: string;
    readonly seeds: { readonly prefix: string; readonly firstId: number; readonly count: number };
    readonly stages: readonly CalibrationMeasurementStage[];
  };
  readonly parameters: readonly CalibrationParameters[];
  readonly git?: unknown;
  readonly runtime?: unknown;
  readonly startedAt?: string;
}

export function sampleStatistics(data: readonly number[]) {
  let mean = 0, m2 = 0, n = 0, min = Infinity, max = -Infinity;
  for (const value of data) {
    n++;
    const delta = value - mean;
    mean += delta / n;
    m2 += delta * (value - mean);
    min = Math.min(min, value); max = Math.max(max, value);
  }
  const variance = n > 1 ? m2 / (n - 1) : null;
  return { n, mean: n ? mean : null, variance, standardError: variance === null ? null : Math.sqrt(variance / n),
    min: n ? min : null, max: n ? max : null };
}

const QUERY_BLOCK_SIZE = 256;

/** Transpose a complete version-1 measurement file using its embedded manifest.
 * Binary temporary storage avoids holding the entire campaign in JS arrays.
 * Input records may arrive in any seed/parameter order; output seeds are sorted.
 */
export async function writeCalibrationTable(inputPath: string, outputPath: string): Promise<number> {
  const input = resolve(inputPath), output = resolve(outputPath);
  if (input === output) throw new Error('Input and output must differ');
  const directory = mkdtempSync(join(tmpdir(), 'polis-calibration-table-'));
  const spool = openSync(join(directory, 'counts.bin'), 'wx+');
  let outputFd: number | undefined;
  const stream = createReadStream(input);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let header: Header | undefined, queryCount = 0, seen: Uint8Array = new Uint8Array(), worlds = 0, complete = false;
    for await (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as Record<string, unknown>;
      if (!record || typeof record !== 'object') throw new Error('Invalid JSONL record');
      if (complete) throw new Error('Records after completion');
      if (!header) {
        header = validateHeader(record);
        queryCount = header.manifest.stages.reduce((sum, stage) => sum + stage.queries.length, 0);
        const totalWorlds = header.manifest.seeds.count * header.parameters.length;
        if (!Number.isSafeInteger(totalWorlds * queryCount * 8)) throw new Error('Measurement dimensions exceed exact file offsets');
        seen = new Uint8Array(totalWorlds);
        continue;
      }
      const { count: seedCount, firstId } = header.manifest.seeds;
      if (record.type === 'complete') {
        if (worlds !== seen.length || record.completedWorlds !== worlds || record.completedSeeds !== seedCount) {
          throw new Error('Incomplete or inconsistent world counts');
        }
        complete = true;
        continue;
      }
      if (record.type !== 'sample') throw new Error(`Expected sample or complete, got ${String(record.type)}`);
      const seed = Number(record.seedId) - firstId, parameter = record.parameterIndex;
      if (typeof record.seedId !== 'number' || !Number.isInteger(seed) || seed < 0 || seed >= seedCount ||
        typeof parameter !== 'number' || !Number.isInteger(parameter) || parameter < 0 || parameter >= header.parameters.length) {
        throw new Error('Invalid seed or parameter index');
      }
      const world = parameter * seedCount + seed;
      if (seen[world]) throw new Error('Duplicate seed/parameter sample');
      const counts = record.counts;
      if (!Array.isArray(counts) || counts.length !== header.manifest.stages.length) throw new Error('Invalid stage count');
      const buffer = Buffer.allocUnsafe(queryCount * 8);
      let offset = 0;
      for (const [stageIndex, stage] of header.manifest.stages.entries()) {
        const values: unknown = counts[stageIndex];
        if (!Array.isArray(values) || values.length !== stage.queries.length) throw new Error('Invalid query count');
        for (const value of values) {
          if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid sampled count');
          buffer.writeDoubleLE(value, offset); offset += 8;
        }
      }
      writeAll(spool, buffer, world * queryCount * 8);
      seen[world] = 1; worlds++;
    }
    if (!header || !complete) throw new Error('Input is incomplete: missing manifest or completion record');

    outputFd = openSync(output, 'wx');
    const writeRow = (row: unknown) => writeAll(outputFd!, Buffer.from(JSON.stringify(row) + '\n'));
    const targets = header.manifest.stages.flatMap(({ queries, ...stage }) => queries.map((query) => ({ stage, query })));
    const { count: seedCount, firstId, prefix } = header.manifest.seeds;
    let rows = 0;
    for (const [parameterIndex, parameters] of header.parameters.entries()) {
      for (let start = 0; start < queryCount; start += QUERY_BLOCK_SIZE) {
        const width = Math.min(QUERY_BLOCK_SIZE, queryCount - start);
        const block = Buffer.allocUnsafe(width * seedCount * 8);
        for (let seed = 0; seed < seedCount; seed++) {
          const position = ((parameterIndex * seedCount + seed) * queryCount + start) * 8;
          readAll(spool, block, seed * width * 8, width * 8, position);
        }
        for (let index = 0; index < width; index++) {
          const data = Array.from({ length: seedCount }, (_, seed) => block.readDoubleLE((seed * width + index) * 8));
          const stats = sampleStatistics(data), { stage, query } = targets[start + index];
          writeRow({ type: 'query-summary', formatVersion: 1, manifestId: header.manifest.id,
            parameterIndex, parameters, stage, query,
            seeds: { prefix, firstId, count: seedCount }, statistics: stats, data,
            source: { file: input, startedAt: header.startedAt, git: header.git, runtime: header.runtime } });
          rows++;
        }
      }
    }
    return rows;
  } finally {
    lines.close(); stream.destroy();
    if (outputFd !== undefined) closeSync(outputFd);
    closeSync(spool);
    rmSync(directory, { recursive: true, force: true });
  }
}

function validateHeader(record: Record<string, unknown>): Header {
  if (record.type !== 'manifest' || record.formatVersion !== 1) throw new Error('Expected version-1 manifest header');
  const header = record as unknown as Header;
  const seeds = header.manifest?.seeds;
  if (!seeds || typeof seeds.prefix !== 'string' || !Number.isSafeInteger(seeds.firstId) ||
    !Number.isSafeInteger(seeds.count) || seeds.count < 1 || !Number.isSafeInteger(seeds.firstId + seeds.count - 1) ||
    typeof header.manifest.id !== 'string' || !Array.isArray(header.manifest.stages) || !header.manifest.stages.length ||
    !Array.isArray(header.parameters) || !header.parameters.length) throw new Error('Invalid manifest dimensions');
  const stageIds = new Set<string>();
  for (const stage of header.manifest.stages) {
    if (!stage || typeof stage.id !== 'string' || stageIds.has(stage.id) || !Array.isArray(stage.queries) || !stage.queries.length) throw new Error('Invalid manifest stage');
    stageIds.add(stage.id);
    const queryIds = new Set<string>();
    for (const query of stage.queries) {
      if (!query || typeof query.id !== 'string' || queryIds.has(query.id) || !['population', 'flow', 'temporal-split'].includes(query.kind)) throw new Error('Invalid manifest query');
      queryIds.add(query.id);
    }
  }
  for (const p of header.parameters) {
    if (!p?.origin || ![p.origin.min, p.origin.max, p.populationDensity, p.diffusionRate].every(Number.isFinite) ||
      p.origin.max <= p.origin.min || p.populationDensity < 0 || p.diffusionRate < 0) throw new Error('Invalid model parameters');
  }
  return header;
}
function writeAll(fd: number, data: Buffer, position?: number): void {
  let offset = 0;
  while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset, position === undefined ? null : position + offset);
}
function readAll(fd: number, data: Buffer, offset: number, length: number, position: number): void {
  let read = 0;
  while (read < length) {
    const amount = readSync(fd, data, offset + read, length - read, position + read);
    if (!amount) throw new Error('Unexpected end of temporary measurement data');
    read += amount;
  }
}
