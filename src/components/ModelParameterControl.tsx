import { useState, type FormEvent } from 'react';

interface ModelParameterControlProps {
  readonly ariaLabel: string;
  readonly label: string;
  readonly setValue: (value: number) => void;
  readonly value: number;
}

export function ModelParameterControl({
  ariaLabel,
  label,
  setValue,
  value,
}: ModelParameterControlProps) {
  const [draft, setDraft] = useState(String(value));

  const apply = () => {
    const parsed = draft.trim() === '' ? Number.NaN : Number(draft);
    if (Number.isFinite(parsed) && parsed >= 0) {
      setDraft(String(parsed));
      if (parsed !== value) setValue(parsed);
    } else {
      setDraft(String(value));
    }
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    apply();
    event.currentTarget.querySelector('input')?.blur();
  };

  return (
    <form className="model-parameter-control" onSubmit={onSubmit}>
      <label>
        {label}{' '}
        <input
          aria-label={ariaLabel}
          inputMode="decimal"
          value={draft}
          onBlur={apply}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
    </form>
  );
}
