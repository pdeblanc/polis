import { useCallback, useState, type FormEvent } from 'react';
import { useUrlNumberParameter } from '../helpers/urlState';
import { Birds2a } from '../models/birds2a/birds2a';
import { BirdsCanvas } from './BirdsCanvas';

const INITIAL_VIEW = { centerX: 0.5, centerY: 0, area: 2 };
const dyadicWidth = (n: number) => n > 0 && Number.isInteger(Math.log2(n));

export function Birds2aCanvas() {
  const [originMin, setOriginMin] = useUrlNumberParameter('origin', 0);
  const [originWidth, setOriginWidth] = useUrlNumberParameter('originWidth', 1, dyadicWidth);
  const validOrigin = Number.isSafeInteger(originMin / originWidth);
  const createModel = useCallback(
    (seed: string, density: number, diffusion: number) =>
      new Birds2a(seed, density, diffusion, { min: originMin, max: originMin + originWidth }),
    [originMin, originWidth],
  );
  const control = <OriginControl key={originMin + ':' + originWidth} min={originMin} width={originWidth} apply={(min, width) => {
    setOriginMin(min); setOriginWidth(width);
  }} />;
  if (!validOrigin) return <>{control}<span role="alert">Origin must be an aligned dyadic interval.</span></>;
  return <BirdsCanvas createModel={createModel} defaultSeed="Polis 4" defaultPopulationDensity={32}
    initialViewport={INITIAL_VIEW} modelName="Birds 2a">
    {control}
  </BirdsCanvas>;
}

function OriginControl({ min, width, apply }: { min: number; width: number; apply: (min: number, width: number) => void }) {
  const [draftMin, setMin] = useState(String(min)), [draftWidth, setWidth] = useState(String(width));
  const [error, setError] = useState<string>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextMin = Number(draftMin), nextWidth = Number(draftWidth);
    if (!draftMin.trim() || !draftWidth.trim() || !Number.isFinite(nextMin) || !dyadicWidth(nextWidth) ||
      !Number.isSafeInteger(nextMin / nextWidth)) { setError('Origin must be an aligned dyadic interval.'); return; }
    setError(undefined); apply(nextMin, nextWidth);
  };
  return <form className="model-parameter-control birds2a-origin-control" onSubmit={submit}>
    <label>Origin <input aria-label="Origin minimum" value={draftMin} onChange={(e) => setMin(e.target.value)} /></label>
    <label>Width <input aria-label="Origin width" value={draftWidth} onChange={(e) => setWidth(e.target.value)} /></label>
    <button type="submit">Apply origin</button>
    {error && <span role="alert">{error}</span>}
  </form>;
}
