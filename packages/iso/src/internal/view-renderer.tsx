import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import type { StreamStatus } from './use-loader-runner.js';
import { ReloadContext } from '../reload-context.js';
import { LoaderDataContext } from './contexts.js';
import { LoaderStatusContext } from './loader.js';

/**
 * The arguments `ViewRenderer` hands every render function. `data` is `unknown`
 * here: this internal seam erases the per-form data type (`Serialize<T>` for a
 * single-value view, the caller's `Acc` for an accumulating one) that the
 * public `LoaderRef.View` overloads enforce. The extra index signature carries
 * the consumer's spread props.
 */
export type ViewRenderArgs = {
  data: unknown;
  /**
   * True while a fetch/stream-connect is in flight: a cold load that has not
   * resolved (`data` is `undefined`), or an explicit `reload()` (`data` retains
   * the previous value, stale-while-revalidate). Supersedes the old
   * reload-context `reloading` boolean.
   */
  loading: boolean;
  status: StreamStatus;
  error: Error | null;
  reload: () => void;
  [key: string]: unknown;
};

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
  loaderRef: LoaderRef<T, boolean>;
  props: Record<string, unknown>;
  render: (args: ViewRenderArgs) => ComponentChildren;
}) {
  const dataCtx = useContext(LoaderDataContext);
  const data = dataCtx?.data;
  const loading = dataCtx?.loading ?? false;
  const error = loaderRef.useError();
  const status = useContext(LoaderStatusContext);
  const reloadCtx = useContext(ReloadContext);
  const reload = reloadCtx?.reload ?? (() => {});
  return render({ data, loading, status, error, reload, ...props });
}
