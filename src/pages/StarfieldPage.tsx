import { BackLink, Page } from '../components/Page';

export function StarfieldPage() {
  return (
    <Page
      eyebrow="Experiment 01"
      title="Bounded Poisson-like starfield"
      introduction={
        <p>
          The model and interactive viewport will be added in the next implementation
          slice.
        </p>
      }
    >
      <BackLink />
      <div className="viewport-placeholder" role="img" aria-label="Starfield viewport placeholder">
        Starfield viewport
      </div>
    </Page>
  );
}
