import { BirdsCanvas } from '../components/BirdsCanvas';
import { BackLink, Page } from '../components/Page';
import { Birds2b } from '../models/birds2b/birds2b';

const INITIAL_VIEW = { centerX: 0, centerY: 0, area: 2 };
const createModel = (seed: string, density: number, diffusion: number) => new Birds2b(seed, density, diffusion);

export function Birds2bPage() {
  return <Page className="viewport-page" eyebrow="Experiment 05" title="Birds 2b: summed channels"
    introduction={<p>A global population composed from independent time-zero origin channels. The future points upward.</p>}>
    <BackLink />
    <BirdsCanvas createModel={createModel} defaultSeed="Polis 5" initialViewport={INITIAL_VIEW} modelName="Birds 2b" />
  </Page>;
}
