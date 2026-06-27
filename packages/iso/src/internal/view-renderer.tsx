import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { LoaderState, StreamState } from '../loader-state.js';
import { LoaderDataContext } from './contexts.js';

/**
 * The discriminated value `ViewRenderer` hands every render function: a
 * `LoaderState` for a single-value loader or a `StreamState` for a `live` one,
 * the data type erased to `unknown` at this internal seam (the public
 * `LoaderRef.View` overloads restore `Serialize<T>` / the caller's `Acc`). The
 * index signature carries the consumer's spread props. Pattern-match on
 * `status`; the explicit `reload()` callback is read via `useReload()`, not
 * handed in here.
 */
export type ViewState = (LoaderState<unknown> | StreamState<unknown>) & {
  [key: string]: unknown;
};

// Reads the PROJECTED union straight off `LoaderDataContext` (computed once in
// `loader.tsx`) and merges the consumer's spread props, then hands `union &
// props` to the render function. It no longer re-projects loose fields: the
// discriminant is authoritative on context, so a `live` loader's `StreamState`
// and a single-value loader's `LoaderState` both ride the same context and are
// read here without a second derivation (review #6). Lives here, next to its
// context dependency, rather than in define-loader.ts.
export function ViewRenderer({
  props,
  render,
}: {
  props: Record<string, unknown>;
  render: (args: ViewState) => ComponentChildren;
}) {
  const state = useContext(LoaderDataContext);
  if (!state) {
    throw new Error(
      'loader.View render function must be rendered inside a `loader.View` / `loader.Boundary`.'
    );
  }
  // `state` is the projected union; spread the consumer props last so they
  // compose onto it (the render arg is `union & props`).
  return render({ ...state, ...props });
}
