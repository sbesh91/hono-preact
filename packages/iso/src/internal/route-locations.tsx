import { createContext, h } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';

const EMPTY_MAP: ReadonlyMap<string, RouteHook> = Object.freeze(new Map());
export const RouteLocationsContext = createContext<ReadonlyMap<string, RouteHook>>(EMPTY_MAP);

export function RouteLocationsProvider({
  moduleKey,
  location,
  children,
}: {
  moduleKey: string | undefined;
  location: RouteHook;
  children?: ComponentChildren;
}) {
  const parent = useContext(RouteLocationsContext);
  const next = useMemo(() => {
    if (!moduleKey) return parent;
    const m = new Map(parent);
    m.set(moduleKey, location);
    return m;
  }, [parent, moduleKey, location]);
  return h(RouteLocationsContext.Provider, { value: next }, children);
}
