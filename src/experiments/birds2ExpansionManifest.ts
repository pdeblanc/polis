/** Fixed measurement queries, independent of density, diffusion and sampled support.
 * Times follow the expansion's outward direction, including on the negative branch.
 * This object is a specification only: importing it does not initialize any models.
 */
export interface ExpansionObservationCell {
  readonly min: number;
  readonly max: number;
  readonly time: number;
}

export type ExpansionMeasurementQuery =
  | { readonly id: string; readonly kind: 'population'; readonly cell: ExpansionObservationCell }
  | { readonly id: string; readonly kind: 'flow'; readonly from: ExpansionObservationCell;
      readonly to: ExpansionObservationCell }
  | { readonly id: string; readonly kind: 'temporal-split'; readonly from: ExpansionObservationCell;
      readonly via: ExpansionObservationCell; readonly to: ExpansionObservationCell };

export interface ExpansionMeasurementStage {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly epoch: number;
  readonly branch?: 'forward' | 'backward';
  /** Path within the retained epoch; interpret missing sparse entries as zero. */
  readonly record: string;
  readonly queries: readonly ExpansionMeasurementQuery[];
}

// Query coordinates are deliberately fixed, not derived from modelParameters.
const QUERY_BASE_WIDTH = 1;
const QUERY_BASE_DURATION = 1;
const POPULATION_INDICES = [-4, -2, -1, 0, 1, 2, 4] as const;
const INITIAL_INDICES = [-16, ...POPULATION_INDICES, 16] as const;
const SOURCE_INDICES = [-2, -1, 0, 1, 2] as const;
const FLOW_OFFSETS = [-4, -2, -1, 0, 1, 2, 4] as const;
const INTERMEDIATE_OFFSETS = [-2, -1, 0, 1, 2] as const;
const BRANCHES = [{ name: 'forward', sign: 1 }, { name: 'backward', sign: -1 }] as const;

export const birds2ExpansionManifest = {
  id: 'birds2-single-channel-expansion',
  title: 'Birds 2 single-channel expansion count distributions',
  description: 'Unconditional counts in generation order. Run every query for every initialization; absent sparse entries are zero.',
  seeds: {
    prefix: 'Polis Birds 2 expansion calibration:',
    firstId: 0,
    count: 1000,
  },
  modelParameters: {
    origins: [{ min: 0, max: 1 }],
    populationDensities: [0.25, 2.5, 25, 250],
    diffusionRates: [0, 0.5, 2, 4],
  },
  stages: [
    {
      id: 'initial.origin-population',
      title: 'Initial origin population',
      description: 'The time-zero population in the specified interval.',
      epoch: 0,
      record: 'atZero',
      queries: [{ id: 'origin', kind: 'population', cell: cell(QUERY_BASE_WIDTH, 0, 0) }],
    },
    ...BRANCHES.flatMap(({ name, sign }): ExpansionMeasurementStage[] => {
      const time = sign * QUERY_BASE_DURATION;
      return [
        {
          id: `initial.${name}.flows`, title: `Initial ${name} flows`,
          description: 'Allocate the origin population to fixed destination intervals, including tail sentinels.',
          epoch: 0, branch: name, record: `${name}Step`,
          queries: INITIAL_INDICES.map((j) => ({ id: `destination-${j}`, kind: 'flow',
            from: cell(QUERY_BASE_WIDTH, 0, 0), to: cell(QUERY_BASE_WIDTH, j, time) })),
        },
        {
          id: `initial.${name}.populations`, title: `Initial ${name} endpoint populations`,
          description: 'These counts equal the corresponding initial origin-flow counts; they are aliases, not additional samples.',
          epoch: 0, branch: name, record: name,
          queries: populations(QUERY_BASE_WIDTH, time, INITIAL_INDICES),
        },
      ];
    }),
    ...BRANCHES.map(({ name, sign }): ExpansionMeasurementStage => ({
      id: `initial.${name}.ordinary-flows`, title: `Initial ${name} coarsened and mixed flows`,
      description: 'Deterministic endpoint aggregations of the initial step.',
      epoch: 0, branch: name, record: 'ordinaryFlows',
      queries: quarterViews(QUERY_BASE_WIDTH, 0, sign * QUERY_BASE_DURATION),
    })),
    ...[1, 2, 3].flatMap(expansionStages),
  ] satisfies readonly ExpansionMeasurementStage[],
} as const;

function cell(width: number, index: number, time: number): ExpansionObservationCell {
  return { min: index === 0 ? 0 : index * width, max: (index + 1) * width, time };
}

function populations(width: number, time: number, indices: readonly number[] = POPULATION_INDICES): ExpansionMeasurementQuery[] {
  return indices.map((j) => ({ id: `cell-${j}`, kind: 'population', cell: cell(width, j, time) }));
}

function flows(fromWidth: number, toWidth: number, fromTime: number, toTime: number): ExpansionMeasurementQuery[] {
  return SOURCE_INDICES.flatMap((i) => FLOW_OFFSETS.map((d) => ({
    id: `widths-${fromWidth}-${toWidth}/source-${i}/offset-${d}`,
    kind: 'flow' as const,
    from: cell(fromWidth, i, fromTime),
    to: cell(toWidth, Math.floor(i * fromWidth / toWidth) + d, toTime),
  })));
}

function splits(width: number, fromTime: number, viaTime: number, toTime: number,
  denominator: 2 | 3): ExpansionMeasurementQuery[] {
  return SOURCE_INDICES.flatMap((i) => FLOW_OFFSETS.flatMap((d) => INTERMEDIATE_OFFSETS.map((r) => ({
    id: `source-${i}/offset-${d}/intermediate-${r}`,
    kind: 'temporal-split' as const,
    from: cell(width, i, fromTime),
    via: cell(width, i + Math.floor(d / denominator) + r, viaTime),
    to: cell(width, i + d, toTime),
  }))));
}

function quarterViews(width: number, fromTime: number, toTime: number): ExpansionMeasurementQuery[] {
  return [[width, width], [2 * width, 2 * width], [width, 2 * width], [2 * width, width]]
    .flatMap(([u, v]) => flows(u, v, fromTime, toTime));
}

function expansionStages(epoch: number): ExpansionMeasurementStage[] {
  const width = QUERY_BASE_WIDTH * 2 ** (epoch - 1);
  const duration = QUERY_BASE_DURATION * 4 ** (epoch - 1);
  const stages = BRANCHES.flatMap(({ name, sign }) => {
    const t = sign * duration;
    const stage = (id: string, title: string, description: string, record: string,
      queries: ExpansionMeasurementQuery[]): ExpansionMeasurementStage => ({
      id: `epoch-${epoch}.${name}.${id}`, title, description,
      epoch, branch: name, record: `${name}Extension.${record}`, queries,
    });
    return [
      stage('direct-flow', 'Direct extension flows',
        'Allocate each inherited T population to 4T destinations.', 'direct',
        flows(width, width, t, 4 * t)),
      stage('endpoint-population', 'Fine endpoint populations',
        'Aggregate direct flows over their T sources.', 'direct.to', populations(width, 4 * t)),
      stage('first-split', 'First temporal allocations',
        'Count birds through fixed T, 2T and 4T cells, without conditioning trials on parent counts.',
        'firstBridges', splits(width, t, 2 * t, 4 * t, 3)),
      stage('first-leg', 'First adjacent flows',
        'Sum first temporal allocations over 4T destinations.', 'steps[0]', flows(width, width, t, 2 * t)),
      stage('first-population', 'First intermediate populations',
        'Sum T to 2T flows over their T sources.', 'steps[0].to', populations(width, 2 * t)),
      stage('remaining-flow', 'Aggregated remaining flows',
        'Sum first temporal allocations over their former T sources before the next split.',
        'fromTwo', flows(width, width, 2 * t, 4 * t)),
      stage('second-split', 'Second temporal allocations',
        'Count birds through fixed 2T, 3T and 4T cells. The former T source is no longer retained.',
        'secondBridges', splits(width, 2 * t, 3 * t, 4 * t, 2)),
      stage('second-leg', 'Second adjacent flows',
        'Sum second temporal allocations over 4T destinations.', 'steps[1]', flows(width, width, 2 * t, 3 * t)),
      stage('second-population', 'Second intermediate populations',
        'Sum 2T to 3T flows over their 2T sources.', 'steps[1].to', populations(width, 3 * t)),
      stage('third-leg', 'Final adjacent flows',
        'Sum second temporal allocations over their 2T sources.', 'steps[2]', flows(width, width, 3 * t, 4 * t)),
      stage('coarsened-population', 'Coarsened endpoint populations',
        'Aggregate adjacent fine endpoint cells for the next epoch.', 'coarsened', populations(2 * width, 4 * t)),
    ];
  });
  for (const { name, sign } of BRANCHES) {
    const t = sign * duration;
    const stage = (id: string, title: string, queries: ExpansionMeasurementQuery[]): ExpansionMeasurementStage => ({
      id: `epoch-${epoch}.${name}.${id}`, title,
      description: 'Deterministic ordinary-flow view; all counts are contributions from the initialized origin only.',
      epoch, branch: name, record: 'ordinaryFlows', queries,
    });
    stages.push(
      stage('origin-two', 'Origin to first intermediate flows', flows(2 * width, 2 * width, 0, 2 * t)),
      stage('origin-four', 'Origin to endpoint flows', quarterViews(2 * width, 0, 4 * t)),
      stage('coarse-half', 'Coarsened remaining flows', flows(2 * width, 2 * width, 2 * t, 4 * t)),
      ...[1, 2, 3].map((step) => stage(`ordinary-step-${step}`, `Adjacent step ${step} coarsened and mixed flows`,
        quarterViews(width, step * t, (step + 1) * t))),
    );
  }
  return stages;
}
