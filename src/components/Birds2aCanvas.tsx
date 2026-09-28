import { useCallback, useState } from 'react';
import type { BirdsQueryApi, BirdsPopulationResolution } from '../models/birds/birdsQueryApi';
import { useUrlNumberParameter } from '../helpers/urlState';
import { Birds2a } from '../models/birds2a/birds2a';
import { BirdsCanvas } from './BirdsCanvas';

const INITIAL_VIEW = { centerX: 0.5, centerY: 0, area: 2 };
const dyadicWidth = (n: number) => n > 0 && Number.isInteger(Math.log2(n));
const populationSupport = (model: BirdsQueryApi, time: number, resolution: BirdsPopulationResolution) => {
  const bound = model instanceof Birds2a ? model.populationSupport(time) : undefined;
  if (!bound) return undefined;
  const width = resolution.cellWidth;
  return { min: Math.floor(bound.min / width) * width, max: Math.ceil(bound.max / width) * width };
};

export function Birds2aCanvas() {
  const [showSupport, setShowSupport] = useState(true);
  const [originMin, setOriginMin] = useUrlNumberParameter('origin', 0);
  const [originWidth, setOriginWidth] = useUrlNumberParameter('originWidth', 1, dyadicWidth);
  const validOrigin = Number.isSafeInteger(originMin / originWidth);
  const createModel = useCallback(
    (seed: string, density: number, diffusion: number) =>
      new Birds2a(seed, density, diffusion, { min: originMin, max: originMin + originWidth }),
    [originMin, originWidth],
  );
  const control = <OriginControl min={originMin} width={originWidth} apply={(min, width) => {
    setOriginMin(min); setOriginWidth(width);
  }} />;
  if (!validOrigin) return <>{control}<span role="alert">Origin must be an aligned dyadic interval.</span></>;
  return <BirdsCanvas createModel={createModel} defaultSeed="Polis 4" defaultPopulationDensity={32}
    initialViewport={INITIAL_VIEW} modelName="Birds 2a" populationSupport={showSupport ? populationSupport : undefined}>
    {control}
    <label title="Amber: conservative population support at each sampled time, rounded outward to the display grid; not the occupied region.">
      <input type="checkbox" checked={showSupport} onChange={(event) => setShowSupport(event.target.checked)} /> Support bound
    </label>
  </BirdsCanvas>;
}

function OriginControl({ min, width, apply }: { min: number; width: number; apply: (min: number, width: number) => void }) {
  const max = min + width;
  // Unit intervals meet at zero; successive intervals double outward.
  const leftWidth = Math.max(1, min > 0 ? min / 2 : -min);
  const rightWidth = Math.max(1, max < 0 ? -max / 2 : max);
  return <div className="birds2a-origin-control" role="group" aria-label="Origin interval">
    <span>Origin</span>
    <button type="button" aria-label="Previous origin interval" onClick={() => apply(min - leftWidth, leftWidth)}>←</button>
    <span aria-live="polite">[{min}, {max})</span>
    <button type="button" aria-label="Next origin interval" onClick={() => apply(max, rightWidth)}>→</button>
  </div>;
}
