/// <reference types="node" />
import { closeSync, openSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { Birds2aMeanQueries } from '../models/birds2a/birds2aMeans';
import { readCalibrationHeader } from './birds2CalibrationTable';

/** Query/parameter rows matching the sample table, without a seed dimension.
 * Only the input header is needed; even an unfinished sampling run defines its
 * reference targets. This does not validate or endorse the sampled results.
 */
export async function writeCalibrationReference(inputPath: string, outputPath: string,
  progress?: (completedParameters: number, totalParameters: number) => void): Promise<number> {
  const input = resolve(inputPath), output = resolve(outputPath);
  if (input === output) throw new Error('Input and output must differ');
  const header = await readCalibrationHeader(input);
  const fd = openSync(output, 'wx');
  // Mean is linear in density. Reuse unit-density integrals across densities,
  // retaining the reference model's bounded caches for each origin/diffusion.
  const models = new Map<string, Birds2aMeanQueries>();
  let rows = 0;
  try {
    progress?.(0, header.parameters.length);
    for (const [parameterIndex, parameters] of header.parameters.entries()) {
      const key = JSON.stringify([parameters.origin.min, parameters.origin.max, parameters.diffusionRate]);
      let model = models.get(key);
      if (!model) {
        model = new Birds2aMeanQueries(1, parameters.diffusionRate, parameters.origin);
        models.set(key, model);
      }
      for (const { queries, ...stage } of header.manifest.stages) for (const query of queries) {
        const observations = query.kind === 'population' ? [query.cell]
          : query.kind === 'flow' ? [query.from, query.to] : [query.from, query.via, query.to];
        let mean: number;
        try {
          mean = parameters.populationDensity === 0 ? 0 : parameters.populationDensity * model.queryMarginal(observations);
          if (!Number.isFinite(mean) || mean < 0) throw new Error('Invalid marginal mean');
        } catch (error) {
          throw new Error(`Reference failed at parameter ${parameterIndex}, ${stage.id}/${query.id}`, { cause: error });
        }
        const row = { type: 'query-reference', formatVersion: 1, manifestId: header.manifest.id,
          parameterIndex, parameters, stage, query, distribution: { kind: 'poisson', mean },
          referenceModel: 'Birds2aMeans',
          source: { file: input, startedAt: header.startedAt, git: header.git, runtime: header.runtime } };
        const buffer = Buffer.from(JSON.stringify(row) + '\n');
        let offset = 0;
        while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
        rows++;
      }
      progress?.(parameterIndex + 1, header.parameters.length);
    }
    return rows;
  } finally { closeSync(fd); }
}
