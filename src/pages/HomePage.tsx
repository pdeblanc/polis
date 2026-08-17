import { Link } from 'react-router-dom';
import { Page } from '../components/Page';

const experiments = [
  {
    description:
      'An unbounded-looking point field generated lazily from hierarchical, addressed randomness.',
    path: '/starfield',
    title: 'Bounded Poisson-like starfield',
  },
  {
    description:
      'A correlated height field evaluated locally through a coarse-to-fine dependency graph.',
    path: '/terrain',
    title: 'Diamond-square terrain',
  },
] as const;

export function HomePage() {
  return (
    <Page
      documentTitle="Polis"
      eyebrow="Procedural world experiments"
      title="Polis"
      introduction={
        <p>
          Explore deterministic worlds computed from a seed, a location, and a
          requested spatial scale.
        </p>
      }
    >
      <section className="experiment-grid" aria-label="Experiments">
        {experiments.map((experiment) => (
          <Link className="experiment-card" key={experiment.path} to={experiment.path}>
            <h2>{experiment.title}</h2>
            <p>{experiment.description}</p>
            <span aria-hidden="true">Open experiment →</span>
          </Link>
        ))}
      </section>
    </Page>
  );
}
