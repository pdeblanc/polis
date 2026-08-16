import { BackLink, Page } from '../components/Page';
import { StarfieldHierarchyCanvas } from '../components/StarfieldHierarchyCanvas';

export function StarfieldPage() {
  return (
    <Page
      className="viewport-page"
      eyebrow="Experiment 01"
      title="Bounded Poisson-like starfield"
      introduction={
        <p>
          Navigate a deterministic point field and inspect its canonical query dependencies.
        </p>
      }
    >
      <BackLink />
      <StarfieldHierarchyCanvas />
    </Page>
  );
}
