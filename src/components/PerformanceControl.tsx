import type { FramePerformance } from '../helpers/useFramePerformance';

type PerformanceControlProps = {
  readonly performance: FramePerformance;
};

export function PerformanceControl({ performance }: PerformanceControlProps) {
  return (
    <span className="performance-control">
      <span>FPS {Math.round(performance.framesPerSecond)}</span>
      <span>Queries/frame {performance.queriesPerFrame.toLocaleString()}</span>
    </span>
  );
}
