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
      cache {usage.entries.toLocaleString()} / {usage.capacity.toLocaleString()}
      <button onClick={clearCache} type="button">
        Reset cache
      </button>
    </span>
  );
}
