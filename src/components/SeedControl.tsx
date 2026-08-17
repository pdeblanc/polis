import { useState, type FormEvent } from 'react';

type SeedControlProps = {
  readonly seed: string;
  readonly setSeed: (seed: string) => void;
};

export function SeedControl({ seed, setSeed }: SeedControlProps) {
  const [draft, setDraft] = useState(seed);

  const applySeed = () => {
    if (draft !== seed) setSeed(draft);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    applySeed();
    event.currentTarget.querySelector('input')?.blur();
  };

  return (
    <form className="seed-control" onSubmit={onSubmit}>
      <label>
        Seed{' '}
        <input
          aria-label="World seed"
          value={draft}
          onBlur={applySeed}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
    </form>
  );
}
