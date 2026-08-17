import { BackLink, Page } from '../components/Page';
import { TerrainCanvas } from '../components/TerrainCanvas';

export function TerrainPage() {
  return (
    <Page
      className="viewport-page"
      eyebrow="Experiment 02"
      title="Diamond-square terrain"
      introduction={
        <p>Navigate a deterministic random-access height field at its actual lattice detail.</p>
      }
    >
      <BackLink />
      <TerrainCanvas />
    </Page>
  );
}
