import {
  _defineLoaderStub,
  type DefineLoaderOptions,
  type LoaderRef,
} from '../define-loader.js';
import { fetchLoaderData } from './loader-fetch.js';

type StubOptions = {
  __moduleKey: string;
  __loaderName: string;
  params?: string[] | '*';
  /** Whether the source loader was bound to a route (`serverRoute().loader`).
   * Threaded by the Vite plugin so the client-side `LoaderHost` guard can refuse
   * a route-bound loader consumed with no resolvable location, matching the
   * server ref (which carries `__routeId`). */
  __routeBound?: boolean;
};

export function __$createLoaderStub_hpiso<T = unknown>(
  opts: StubOptions
): LoaderRef<T> {
  // `DefineLoaderOptions` (the full internal opts) is a superset of
  // `StandaloneOpts`, so it is assignable to the second parameter. We use a
  // typed intermediate variable to bypass the inline-literal excess property
  // check: `params` is a route-only field not on the `StandaloneOpts` surface
  // (reserved for Vite plugin transforms and route binding), but this stub IS
  // the Vite plugin shim, so setting it here is intentional and correct.
  const refOpts: DefineLoaderOptions<T> = {
    __moduleKey: opts.__moduleKey,
    __loaderName: opts.__loaderName,
    params: opts.params,
    __routeBound: opts.__routeBound,
  };
  // `_defineLoaderStub` types the ctx as route-bound, so `ctx.location` is read
  // directly (no cast): the runner injects the real route location at runtime,
  // which this Vite-plugin shim forwards to the loader RPC.
  return _defineLoaderStub<T>(async ({ location, signal }) => {
    return fetchLoaderData<T>(
      opts.__moduleKey,
      opts.__loaderName,
      {
        path: location.path,
        pathParams: location.pathParams,
        searchParams: location.searchParams,
      },
      signal
    ).first;
  }, refOpts);
}
