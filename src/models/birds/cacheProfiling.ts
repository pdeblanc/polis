export type BirdsCacheFamily =
  | 'cell'
  | 'flow'
  | 'temporal-batch'
  | 'cell-subdivision'
  | 'outflow-subdivision'
  | 'inflow-subdivision'
  | 'flow-space-subdivision';

export interface BirdsCacheTiming {
  readonly getHits: number;
  readonly getMilliseconds: number;
  readonly getMisses: number;
  readonly keyMilliseconds: number;
  readonly keys: number;
  readonly setMilliseconds: number;
  readonly sets: number;
}

export class BirdsCacheProfiler {
  readonly #timings = new Map<BirdsCacheFamily, MutableCacheTiming>();

  start(): number {
    return performance.now();
  }

  recordKey(family: BirdsCacheFamily, start: number): void {
    const timing = this.#timing(family);
    timing.keys += 1;
    timing.keyMilliseconds += performance.now() - start;
  }

  recordGet(family: BirdsCacheFamily, start: number, hit: boolean): void {
    const timing = this.#timing(family);
    if (hit) timing.getHits += 1;
    else timing.getMisses += 1;
    timing.getMilliseconds += performance.now() - start;
  }

  recordSet(family: BirdsCacheFamily, start: number): void {
    const timing = this.#timing(family);
    timing.sets += 1;
    timing.setMilliseconds += performance.now() - start;
  }

  snapshot(): ReadonlyMap<BirdsCacheFamily, BirdsCacheTiming> {
    return new Map(
      [...this.#timings].map(([family, timing]) => [family, { ...timing }]),
    );
  }

  reset(): void {
    this.#timings.clear();
  }

  #timing(family: BirdsCacheFamily): MutableCacheTiming {
    let timing = this.#timings.get(family);
    if (timing === undefined) {
      timing = {
        getHits: 0,
        getMilliseconds: 0,
        getMisses: 0,
        keyMilliseconds: 0,
        keys: 0,
        setMilliseconds: 0,
        sets: 0,
      };
      this.#timings.set(family, timing);
    }
    return timing;
  }
}

type MutableCacheTiming = {
  -readonly [Key in keyof BirdsCacheTiming]: BirdsCacheTiming[Key];
};
