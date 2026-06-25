import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import {
  toLoaderState,
  toStreamState,
  type LoaderState,
  type StreamState,
} from '../loader-state.js';
import { LoaderDataContext } from './contexts.js';
import { LoaderStatusContext } from './loader.js';

/**
 * The discriminated value `ViewRenderer` hands every render function: a
 * `LoaderState` for a single-value loader or a `StreamState` for a `live` one,
 * the data type erased to `unknown` at this internal seam (the public
 * `LoaderRef.View` overloads restore `Serialize<T>` / the caller's `Acc`). The
 * index signature carries the consumer's spread props. Pattern-match on
 * `status`; the explicit `reload()` callback is now read via `useReload()`,
 * not handed in here.
 */
export type ViewState = (LoaderState<unknown> | StreamState<unknown>) & {
  [key: string]: unknown;
};

// Projects the loose loader-context fields (`data`/`loading` from
// `LoaderDataContext`, the streaming `status`, and the `error` from
// `useError()`) into the public discriminated union, then hands `union & props`
// to the consumer's render function. Reads `LoaderDataContext` directly rather
// than `loaderRef.useData()` so it also serves `live` loaders (whose
// `useData()` throws by design); the accumulated value lands in the same
// context. Lives here, next to its context dependencies, rather than in
// define-loader.ts.
export function ViewRenderer<T>({
  loaderRef,
  props,
  render,
}: {
  loaderRef: LoaderRef<T, boolean>;
  props: Record<string, unknown>;
  render: (args: ViewState) => ComponentChildren;
}) {
  const dataCtx = useContext(LoaderDataContext);
  const data = dataCtx?.data;
  const loading = dataCtx?.loading ?? false;
  const error = loaderRef.useError();
  const status = useContext(LoaderStatusContext);
  const state = loaderRef.live
    ? toStreamState(data, status, error)
    : toLoaderState(data, loading, error);
  return render({ ...state, ...props });
}
