import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import { subscribeToFragment } from './navigator.js';

export type PageHostProps = {
  component: ComponentType<RouteHook>;
  location: RouteHook;
  path: string;
};

export function PageHost({ component: User, location, path }: PageHostProps) {
  const [fragment, setFragment] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToFragment(path, (html) => setFragment(html));
    return unsub;
  }, [path]);

  if (fragment === null) {
    return <User {...location} />;
  }
  // Island mode lands in Task 9. For now, fallback to user component so any
  // tests asserting pre-island behavior pass; the real island mode replaces
  // this branch.
  return <User {...location} />;
}
