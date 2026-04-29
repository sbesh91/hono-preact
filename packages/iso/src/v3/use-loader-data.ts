import { useContext } from 'preact/hooks';
import { LoaderDataContext } from './contexts.js';
import type { LoaderRef } from './define-loader.js';

export function useLoaderData<T>(ref: LoaderRef<T>): T {
  const ctx = useContext(LoaderDataContext);
  if (!ctx)
    throw new Error('useLoaderData must be called inside a <Loader>');
  if (ctx.refId !== ref.__id) {
    throw new Error(
      'useLoaderData(ref) called with a ref that does not match the nearest <Loader>. ' +
        'If you have nested loaders, the inner ref shadows the outer.'
    );
  }
  return ctx.data as T;
}
