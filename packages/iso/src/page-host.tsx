import { hydrate, render, h, type ComponentType, type RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import {
  getLatestFragment,
  isFragmentPending,
  subscribeToFragment,
} from './navigator.js';

export type PageHostProps = {
  component: ComponentType<RouteHook>;
  location: RouteHook;
  path: string;
};

export function PageHost({ component: User, location, path }: PageHostProps) {
  // Initialize from any fragment the navigator already has buffered: the
  // navigator may resolve before PageHost mounts (e.g., a lazy chunk
  // delayed PageHost while the fragment fetch completed).
  const [fragment, setFragment] = useState<string | null>(
    () => getLatestFragment(path) ?? null
  );
  const hostRef: RefObject<HTMLDivElement> = useRef(null);

  useEffect(() => {
    const unsub = subscribeToFragment(path, (html) => setFragment(html));
    return unsub;
  }, [path]);

  useLayoutEffect(() => {
    if (fragment === null) return;
    const host = hostRef.current;
    if (!host) return;
    // Unmount any prior inner Preact tree at this host.
    render(null, host);
    // Replace DOM with new server-rendered HTML.
    host.innerHTML = fragment;
    // Hydrate the user component against the now-populated DOM.
    hydrate(h(User, location), host);
  }, [fragment, location]);

  if (fragment === null) {
    // During a client-side SSR navigation the navigator marks the path
    // pending before fetching. Rendering <User> here would mount the
    // page's loader and fire a /__loaders fetch, then the User subtree
    // would be torn down again as soon as the fragment arrives, causing
    // a visible flicker. The empty placeholder holds the slot until the
    // fragment arrives, at which point we transition to the island
    // branch below.
    if (isFragmentPending(path)) {
      return <div data-hp-pending="true" />;
    }
    return <User {...location} />;
  }
  // Stable container. dangerouslySetInnerHTML={{__html: ''}} tells Preact's
  // outer reconciler not to manage children, so subsequent outer renders
  // never stomp the inner hydrate root. We mutate innerHTML imperatively
  // in useLayoutEffect.
  return (
    <div
      ref={hostRef}
      data-hp-island="true"
      dangerouslySetInnerHTML={{ __html: '' }}
    />
  );
}
