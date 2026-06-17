import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { ReloadContext } from '../reload-context.js';

// Reads the loader's resolved data/error from context and the active reload
// callback, then hands them to the consumer's render function. Lives here,
// next to its context dependencies, rather than in define-loader.ts (which
// stays focused on LoaderRef construction).
export function ViewRenderer<T>({
  loaderRef,
  props,
  render,
}: {
  loaderRef: LoaderRef<T>;
  props: Record<string, unknown>;
  render: (args: any) => ComponentChildren;
}) {
  const data = loaderRef.useData();
  const error = loaderRef.useError();
  const reloadCtx = useContext(ReloadContext);
  const reload = reloadCtx?.reload ?? (() => {});
  return render({ data, error, reload, ...props });
}
