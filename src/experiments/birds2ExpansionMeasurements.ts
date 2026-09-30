import { type BridgeBatch, type ContributionFrame, type ContributionStep,
  type ExpansionCell, type ExpansionEpoch } from '../models/birds2a/expansion';
import { birds2ExpansionManifest, type ExpansionMeasurementQuery,
  type ExpansionMeasurementStage } from './birds2ExpansionManifest';
import { Birds2aEngine } from '../models/birds2a/birds2aEngine';

export interface ExpansionParameters {
  readonly origin: ExpansionCell;
  readonly populationDensity: number;
  readonly diffusionRate: number;
}

export const expansionParameterCombinations: readonly ExpansionParameters[] =
  birds2ExpansionManifest.modelParameters.origins.flatMap((origin) =>
    birds2ExpansionManifest.modelParameters.populationDensities.flatMap((populationDensity) =>
      birds2ExpansionManifest.modelParameters.diffusionRates.map((diffusionRate) =>
        ({ origin, populationDensity, diffusionRate }))));

/** One world initialization, all selected queries, no clearing or resampling.
 * Array positions correspond to the stage and query order in the file header. */
export function measureExpansionWorld(seed: string, parameters: ExpansionParameters,
  stages: readonly ExpansionMeasurementStage[]): readonly (readonly number[])[] {
  const model = new Birds2aEngine(seed, parameters.populationDensity, parameters.diffusionRate, parameters.origin);
  return stages.map((stage) => {
    if (stage.refinement) return readRefinementMeasurements(model, stage);
    if (stage.epoch === undefined) throw new Error('Missing expansion epoch');
    return readExpansionMeasurements(model.expansion.getEpoch(stage.epoch), stage);
  });
}

export function readRefinementMeasurements(model: Birds2aEngine, stage: ExpansionMeasurementStage): number[] {
  if (!stage.refinement) throw new Error('Expected a refinement stage');
  return stage.queries.map((query) => {
    if (query.kind === 'population') return model.queryCell(query.cell);
    const flow = query.from.time < query.to.time
      ? { source: query.from, destination: query.to } : { source: query.to, destination: query.from };
    return query.kind === 'flow' ? model.queryFlow(flow) : model.queryTemporalSplit(flow, query.via);
  });
}

export function readExpansionMeasurements(epoch: ExpansionEpoch, stage: ExpansionMeasurementStage): number[] {
  if (epoch.index !== stage.epoch) throw new Error('Measurement epoch mismatch');
  const record = resolveRecord(epoch, stage.record);
  return stage.queries.map((query) => {
    let count: number;
    if (query.kind === 'population') {
      const frame = requireFrame(record);
      requireGeometry(frame, query.cell);
      count = frame.contributions.find(({ cell }) => sameCell(cell, query.cell))?.count ?? 0;
    } else if (query.kind === 'flow') {
      const steps = Array.isArray(record) ? record.map(requireStep) : [requireStep(record)];
      const step = steps.find(({ from, to }) => matchesGeometry(from, query.from) && matchesGeometry(to, query.to));
      if (!step) throw new Error(`No retained flow geometry for ${stage.id}/${query.id}`);
      count = step.allocations.find(({ fromCell }) => sameCell(fromCell, query.from))
        ?.destinations.find(({ cell }) => sameCell(cell, query.to))?.count ?? 0;
    } else {
      if (!Array.isArray(record) || !/(first|second)Bridges$/.test(stage.record)) {
        throw new Error('Expected a temporal allocation record');
      }
      // A wholly absent batch is a zero observation, not a missing sample.
      const batch = (record as readonly BridgeBatch[]).find((batch) =>
        batch.fromTime === query.from.time && batch.time === query.via.time && batch.toTime === query.to.time &&
        sameCell(batch.fromCell, query.from) && sameCell(batch.toCell, query.to));
      count = batch?.intermediates.find(({ cell }) => sameCell(cell, query.via))?.count ?? 0;
    }
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid measured count');
    return count;
  });
}

function resolveRecord(epoch: ExpansionEpoch, path: string): unknown {
  if (!/^[a-zA-Z]+(?:\.[a-zA-Z]+|\[\d+\])*$/.test(path)) throw new Error(`Invalid record path: ${path}`);
  let value: unknown = epoch;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, part)) {
      throw new Error(`Missing retained record: ${path}`);
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function requireFrame(record: unknown): ContributionFrame {
  if (!record || typeof record !== 'object' || !('contributions' in record) || !('cellWidth' in record)) {
    throw new Error('Expected a population frame');
  }
  return record as ContributionFrame;
}
function requireStep(record: unknown): ContributionStep {
  if (!record || typeof record !== 'object' || !('allocations' in record) || !('from' in record) || !('to' in record)) {
    throw new Error('Expected a flow step');
  }
  return record as ContributionStep;
}
function sameCell(a: ExpansionCell, b: ExpansionCell): boolean { return a.min === b.min && a.max === b.max; }
type ObservedCell = Extract<ExpansionMeasurementQuery, { kind: 'population' }>['cell'];
function matchesGeometry(frame: ContributionFrame, cell: ObservedCell): boolean {
  return frame.time === cell.time && frame.cellWidth === cell.max - cell.min;
}
function requireGeometry(frame: ContributionFrame, cell: ObservedCell): void {
  if (!matchesGeometry(frame, cell)) throw new Error('No retained population geometry for query');
}
