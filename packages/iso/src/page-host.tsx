import { hydrate, render, h, type ComponentType, type RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import { subscribeToFragment } from './navigator.js';

export type PageHostProps = {
  component: ComponentType<RouteHook>;
  location: RouteHook;
  path: string;
};

export function PageHost({ component: User, location, path }: PageHostProps) {
  const [fragment, setFragment] = useState<string | null>(null);
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
