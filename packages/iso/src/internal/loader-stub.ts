import {
  defineLoader,
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

/** The route location the runner injects into every loader ctx at runtime. The
 * standalone `LoaderCtx` type omits `location` (a standalone loader is
 * route-independent), but this stub IS the Vite plugin shim that forwards the
 * active route location to the RPC, so it reads the field through this precise
 * structural type rather than `any` (keeping the field names checked). */
type CtxWithLocation = {
  location: {
    path: string;
    pathParams: Record<string, string>;
    searchParams: Record<string, string>;
  };
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
  // The async fn returns Promise<T>, so TypeScript selects the single-value
  // overload of defineLoader (returning LoaderRef<T, false>). ctx is inferred
  // as the standalone ctx shape (no `location`); the runner injects the real
  // location at runtime, read here through `CtxWithLocation` (no `any`).
  return defineLoader<T>(async (ctx) => {
    const { location: loc } = ctx as unknown as CtxWithLocation;
    return fetchLoaderData<T>(
      opts.__moduleKey,
      opts.__loaderName,
      {
        path: loc.path,
        pathParams: loc.pathParams,
        searchParams: loc.searchParams,
      },
      ctx.signal
    ).first;
  }, refOpts);
}
