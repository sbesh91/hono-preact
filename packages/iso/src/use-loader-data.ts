import { useContext } from 'preact/hooks';
import { LoaderDataContext } from './contexts.js';
import type { LoaderRef } from './define-loader.js';

export function useLoaderData<L>(): L extends LoaderRef<infer T> ? T : L {
  const ctx = useContext(LoaderDataContext);
  if (!ctx) {
    throw new Error(
      'useLoaderData must be called inside a route page that has a loader.'
    );
  }
  return ctx.data as never;
}
