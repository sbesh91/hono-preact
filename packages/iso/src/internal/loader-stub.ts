import { defineLoader, type LoaderRef } from '../define-loader.js';
import { fetchLoaderData } from './loader-fetch.js';

type StubOpts = {
  __moduleKey: string;
  __loaderName: string;
  params?: string[] | '*';
};

export function __$createLoaderStub_hpiso<T = unknown>(
  opts: StubOpts
): LoaderRef<T> {
  const fn = async ({ location, signal }: { location: any; signal?: AbortSignal }) =>
    fetchLoaderData<T>(
      opts.__moduleKey,
      opts.__loaderName,
      {
        path: location.path,
        pathParams: location.pathParams,
        searchParams: location.searchParams,
      },
      signal ?? new AbortController().signal,
      { onChunk: () => {}, onError: () => {}, onEnd: () => {} }
    );
  // defineLoader does the cache + symbol + useData/useError plumbing.
  return defineLoader<T>(fn as any, {
    __moduleKey: opts.__moduleKey,
    __loaderName: opts.__loaderName,
    params: opts.params,
  });
}
