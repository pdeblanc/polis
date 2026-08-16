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
          Move the cursor across the viewport to inspect its nested canonical hierarchy
          cells.
        </p>
      }
    >
      <BackLink />
      <StarfieldHierarchyCanvas />
    </Page>
  );
}
