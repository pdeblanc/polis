export type ProfiledDistribution =
  | 'binomial'
  | 'hypergeometric'
  | 'multinomial'
  | 'multivariateHypergeometric';

export interface DistributionTiming {
  readonly addressEncodingMilliseconds: number;
  readonly calls: number;
  readonly exclusiveMilliseconds: number;
  readonly hashingMilliseconds: number;
  readonly inclusiveMilliseconds: number;
}

export interface DistributionProfile {
  readonly distributionWallMilliseconds: number;
  readonly timings: Readonly<Record<ProfiledDistribution, DistributionTiming>>;
}

interface MutableTiming {
  addressEncodingMilliseconds: number;
  calls: number;
  exclusiveMilliseconds: number;
  hashingMilliseconds: number;
  inclusiveMilliseconds: number;
}

interface Frame {
  readonly distribution: ProfiledDistribution;
  childDistributionMilliseconds: number;
}

interface Session {
  distributionWallMilliseconds: number;
  readonly frames: Frame[];
  readonly timings: Record<ProfiledDistribution, MutableTiming>;
}

let activeSession: Session | undefined;

export function beginDistributionProfile(): void {
  if (activeSession !== undefined) throw new Error('Distribution profiling is already active');
  activeSession = {
    distributionWallMilliseconds: 0,
    frames: [],
    timings: Object.fromEntries(
      ['binomial', 'hypergeometric', 'multinomial', 'multivariateHypergeometric'].map(
        (name) => [name, emptyTiming()],
      ),
    ) as unknown as Record<ProfiledDistribution, MutableTiming>,
  };
}

export function endDistributionProfile(): DistributionProfile {
  const session = activeSession;
  if (session === undefined) throw new Error('Distribution profiling is not active');
  if (session.frames.length !== 0) throw new Error('Distribution profiling ended inside a sample');
  activeSession = undefined;
  return {
    distributionWallMilliseconds: session.distributionWallMilliseconds,
    timings: session.timings,
  };
}

export function profileDistribution<Result>(
  distribution: ProfiledDistribution,
  sample: () => Result,
): Result {
  const session = activeSession;
  if (session === undefined) return sample();
  const frame: Frame = { distribution, childDistributionMilliseconds: 0 };
  session.frames.push(frame);
  const start = performance.now();
  try {
    return sample();
  } finally {
    const elapsed = performance.now() - start;
    session.frames.pop();
    const timing = session.timings[distribution];
    timing.calls += 1;
    timing.inclusiveMilliseconds += elapsed;
    timing.exclusiveMilliseconds += elapsed - frame.childDistributionMilliseconds;
    const parent = session.frames.at(-1);
    if (parent === undefined) session.distributionWallMilliseconds += elapsed;
    else parent.childDistributionMilliseconds += elapsed;
  }
}

export function profileAddressEncoding<Result>(encode: () => Result): Result {
  return profileRandomPart('addressEncodingMilliseconds', encode);
}

export function profileHash<Result>(hash: () => Result): Result {
  return profileRandomPart('hashingMilliseconds', hash);
}

function profileRandomPart<Result>(
  field: 'addressEncodingMilliseconds' | 'hashingMilliseconds',
  operation: () => Result,
): Result {
  const session = activeSession;
  if (session === undefined || session.frames.length === 0) return operation();
  const start = performance.now();
  try {
    return operation();
  } finally {
    const elapsed = performance.now() - start;
    const distributions = new Set(session.frames.map(({ distribution }) => distribution));
    for (const distribution of distributions) {
      session.timings[distribution][field] += elapsed;
    }
  }
}

function emptyTiming(): MutableTiming {
  return {
    addressEncodingMilliseconds: 0,
    calls: 0,
    exclusiveMilliseconds: 0,
    hashingMilliseconds: 0,
    inclusiveMilliseconds: 0,
  };
}
