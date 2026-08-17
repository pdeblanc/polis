import { useCallback, useState } from 'react';

const DISPLAY_FRAME_RATE_LIMIT = 60;

export type FramePerformance = {
  readonly framesPerSecond: number;
  readonly queriesPerFrame: number;
};

export function useFramePerformance() {
  const [performance, setPerformance] = useState<FramePerformance>({
    framesPerSecond: 0,
    queriesPerFrame: 0,
  });

  const measureFrame = useCallback((draw: () => number) => {
    const start = globalThis.performance.now();
    const queriesPerFrame = draw();
    const duration = globalThis.performance.now() - start;
    const framesPerSecond = frameRateForDuration(duration);

    setPerformance((current) =>
      current.framesPerSecond === framesPerSecond &&
      current.queriesPerFrame === queriesPerFrame
        ? current
        : { framesPerSecond, queriesPerFrame },
    );
  }, []);

  return { measureFrame, performance } as const;
}

export function frameRateForDuration(durationMilliseconds: number): number {
  return Math.min(
    DISPLAY_FRAME_RATE_LIMIT,
    1_000 / Math.max(durationMilliseconds, Number.EPSILON),
  );
}
