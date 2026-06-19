import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { ReloadContext } from '../reload-context.js';
import { LoaderDataContext } from './contexts.js';
import { LoaderStatusContext } from './loader.js';

// Reads the loader's resolved data/error/status from context and the active
// reload callback, then hands them to the consumer's render function. Reads
// `LoaderDataContext` directly rather than `loaderRef.useData()` so it also
// serves `live` loaders (whose `useData()` throws by design); the accumulated
// value lands in the same context. Lives here, next to its context
// dependencies, rather than in define-loader.ts.
export function ViewRenderer<T>({
  loaderRef,
  props,
  render,
}: {
  loaderRef: LoaderRef<T>;
  props: Record<string, unknown>;
  render: (args: any) => ComponentChildren;
}) {
  const dataCtx = useContext(LoaderDataContext);
  const data = dataCtx?.data;
  const error = loaderRef.useError();
  const status = useContext(LoaderStatusContext);
  const reloadCtx = useContext(ReloadContext);
  const reload = reloadCtx?.reload ?? (() => {});
  return render({ data, status, error, reload, ...props });
}
