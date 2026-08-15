import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { LoaderState, StreamState } from '../loader-state.js';
import { LoaderDataContext } from './contexts.js';

/**
 * The discriminated value `ViewRenderer` hands every render function's first
 * argument: a `LoaderState` for a single-value loader or a `StreamState` for a
 * `live` one, the data type erased to `unknown` at this internal seam (the
 * public `LoaderRef.View` overloads restore `Serialize<T>` / the caller's
 * `Acc`). Pattern-match on `status`; the explicit `reload()` callback is read
 * via `useReload()`, not handed in here.
 */
export type ViewState = LoaderState<unknown> | StreamState<unknown>;

// Reads the PROJECTED union straight off `LoaderDataContext` (computed once in
// `loader.tsx`) and hands it to the render function as the first argument, with
// the consumer's own props as the second, unmerged. It no longer re-projects
// loose fields: the discriminant is authoritative on context, so a `live`
// loader's `StreamState` and a single-value loader's `LoaderState` both ride
// the same context and are read here without a second derivation (review #6).
// Lives here, next to its context dependency, rather than in define-loader.ts.
//
// Reading `.value` SUBSCRIBES this component to the loader's state, so a render
// function updates on the loader's own change rather than only when the host
// re-provides the context.
export function ViewRenderer({
  props,
  render,
}: {
  props: Record<string, unknown>;
  render: (
    state: ViewState,
    props: Record<string, unknown>
  ) => ComponentChildren;
}) {
  const state = useContext(LoaderDataContext)?.value ?? null;
  if (!state) {
    throw new Error(
      'loader.View render function must be rendered inside a `loader.View` / `loader.Boundary`.'
    );
  }
  // Two separate arguments: the loader's own state, and the consumer's own
  // props, so a prop named `data` or `status` can never alias into the state.
  return render(state, props);
}
