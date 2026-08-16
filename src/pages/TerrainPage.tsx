import { BackLink, Page } from '../components/Page';

export function TerrainPage() {
  return (
    <Page
      eyebrow="Experiment 02"
      title="Diamond-square terrain"
      introduction={
        <p>
          Random-access terrain generation will follow the starfield implementation.
        </p>
      }
    >
      <BackLink />
      <div className="viewport-placeholder" role="img" aria-label="Terrain viewport placeholder">
        Terrain viewport
      </div>
    </Page>
  );
}
