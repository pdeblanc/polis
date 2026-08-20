export interface BirdCell {
  readonly min: number;
  readonly max: number;
  readonly time: number;
}

export interface BirdFlow {
  readonly source: BirdCell;
  readonly destination: BirdCell;
}

export interface BirdTwoStageFlow {
  readonly source: BirdCell;
  readonly midpoint: BirdCell;
  readonly destination: BirdCell;
}

export function cellLength(cell: BirdCell): number {
  return cell.max - cell.min;
}

export function flowDuration(flow: BirdFlow): number {
  return flow.destination.time - flow.source.time;
}

export function twoStageFlowDuration(flow: BirdTwoStageFlow): number {
  return flow.destination.time - flow.source.time;
}
