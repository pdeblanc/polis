import { useEffect, useState } from "react";
import type { ViewportState } from "../utils/geometry/viewport2d";

export function viewportStateFromSearch(
  search: string,
  fallback: ViewportState,
): ViewportState {
  const parameters = new URLSearchParams(search);
  const centerX = finiteParameter(parameters, "x");
  const centerY = finiteParameter(parameters, "y");
  const area = finiteParameter(parameters, "area");
  return {
    centerX: centerX ?? fallback.centerX,
    centerY: centerY ?? fallback.centerY,
    area: area !== undefined && area > 0 ? area : fallback.area,
  };
}

export function useUrlSeed(defaultSeed: string): readonly [string, (seed: string) => void] {
  const [seed, setSeed] = useState(() => {
    const parameter = new URLSearchParams(window.location.search).get("seed");
    return parameter ?? defaultSeed;
  });

  useEffect(() => {
    replaceUrlParameters({ seed });
  }, [seed]);

  return [seed, setSeed] as const;
}

export function useUrlNumberParameter(
  name: string,
  defaultValue: number,
  isValid: (value: number) => boolean = Number.isFinite,
): readonly [number, (value: number) => void] {
  const [value, setValue] = useState(() => {
    const parameter = new URLSearchParams(window.location.search).get(name);
    if (parameter === null || parameter.trim() === '') return defaultValue;
    const parsed = Number(parameter);
    return Number.isFinite(parsed) && isValid(parsed) ? parsed : defaultValue;
  });

  useEffect(() => {
    replaceUrlParameters({ [name]: value === defaultValue ? undefined : String(value) });
  }, [defaultValue, name, value]);

  return [value, setValue] as const;
}

export function replaceUrlParameters(
  values: Readonly<Record<string, string | undefined>>,
): void {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  if (url.href === window.location.href) return;
  window.history.replaceState(window.history.state, "", url);
}

function finiteParameter(parameters: URLSearchParams, name: string): number | undefined {
  const parameter = parameters.get(name);
  if (parameter === null || parameter.trim() === "") return undefined;
  const value = Number(parameter);
  return Number.isFinite(value) ? value : undefined;
}
