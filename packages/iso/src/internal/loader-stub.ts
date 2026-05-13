import { defineLoader, type LoaderRef } from '../define-loader.js';

type StubOpts = {
  __moduleKey: string;
  __loaderName: string;
  params?: string[] | '*';
};

export function __$createLoaderStub_hpiso<T = unknown>(
  opts: StubOpts
): LoaderRef<T> {
  // The stub's fn is a placeholder that throws if invoked directly. Task 13
  // will replace it with the actual RPC fetch arrow that calls
  // fetchLoaderData(moduleKey, loaderName, ...).
  const fn = async () => {
    throw new Error(
      `Loader stub for '${opts.__moduleKey}::${opts.__loaderName}' invoked directly; ` +
      `expected the server-only plugin to replace the fn at build time.`
    );
  };
  // defineLoader does the cache + symbol + useData/useError plumbing.
  return defineLoader<T>(fn as any, {
    __moduleKey: opts.__moduleKey,
    __loaderName: opts.__loaderName,
    params: opts.params,
  });
}
