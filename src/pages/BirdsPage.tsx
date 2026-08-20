import { BirdsCanvas } from '../components/BirdsCanvas';
import { BackLink, Page } from '../components/Page';

export function BirdsPage() {
  return (
    <Page
      className="viewport-page"
      eyebrow="Experiment 03"
      title="Diffusing birds"
      introduction={
        <p>Explore deterministic population snapshots in spacetime, with the future upward.</p>
      }
    >
      <BackLink />
      <BirdsCanvas />
    </Page>
  );
}
