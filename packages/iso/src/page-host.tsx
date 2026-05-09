import { hydrate, render, h, type ComponentType, type RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  LocationProvider,
  Route as PreactIsoRoute,
  Router,
  type RouteHook,
} from 'preact-iso';
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
    // Hydrate the user component against the now-populated DOM. Wrap in
    // LocationProvider + Router so any nested useLocation()/useRoute()
    // or nested <Router> in the page subtree sees the same context the
    // outer tree provides. The Router matches the URL against `path` and
    // sets up RouteContext with the correct `rest`/`pathParams`. Without
    // this wrapping, a nested <Router> falls back to `rest = path` and
    // matches the wrong URL segment (e.g. /movies's nested Router would
    // treat "movies" as the :id param of /:id).
    hydrate(
      h(LocationProvider, null,
        h(Router, null,
          // preact-iso's Route props use a RouteHook discriminated union;
          // path + component is sufficient at runtime, cast to bypass the
          // strict type that expects matchProps fields the parent Router
          // will inject.
          h(PreactIsoRoute, { path, component: User } as never)
        )
      ),
      host
    );
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
