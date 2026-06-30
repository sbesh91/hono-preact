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
  };
  // The async fn returns Promise<T>, so TypeScript selects the single-value
  // overload of defineLoader (returning LoaderRef<T, false>). ctx is inferred
  // as the standalone ctx shape (no `location`). At runtime the loader runner
  // always passes the full LoaderCtx (which carries location), so reading it
  // via (ctx as any).location is safe: this stub is an internal Vite plugin
  // shim that must read the current route location to call the RPC.
  return defineLoader<T>(async (ctx) => {
    const loc = (ctx as any).location as {
      path: string;
      pathParams: Record<string, string>;
      searchParams: Record<string, string>;
    };
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
