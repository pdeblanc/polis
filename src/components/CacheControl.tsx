export type CacheUsage = {
  readonly capacity: number;
  readonly entries: number;
};

type CacheControlProps = {
  readonly clearCache: () => void;
  readonly usage: CacheUsage;
};

export function CacheControl({ clearCache, usage }: CacheControlProps) {
  return (
    <span className="cache-control">
      Cache {usage.entries.toLocaleString()} / {usage.capacity.toLocaleString()}
      <button onClick={clearCache} type="button">
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M13 5V2.5l-1.1 1.1A5.5 5.5 0 1 0 13.4 9" />
        </svg>
        Reset cache
      </button>
    </span>
  );
}
