import { Birds2aCanvas } from '../components/Birds2aCanvas';
import { BackLink, Page } from '../components/Page';

export function Birds2aPage() {
  return <Page className="viewport-page" eyebrow="Experiment 04" title="Birds 2a: single origin"
    introduction={<p>Explore one conserved population from an origin interval at time zero. The future points upward.</p>}>
    <BackLink />
    <Birds2aCanvas />
  </Page>;
}
