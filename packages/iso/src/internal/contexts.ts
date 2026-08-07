import type { Context } from 'hono';
import { createContext } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import type { LoaderState, StreamState } from '../loader-state.js';
import type { CollectView } from './loader-signal.js';

export const HonoRequestContext = createContext<{ context?: Context }>({});

export const LoaderIdContext = createContext<string | null>(null);

/**
 * The PROJECTED public union a loader hands its descendants, computed once in
 * `loader.tsx` (and on the server in `DataReader`). A non-live loader carries a
 * `LoaderState`; a live loader carries a `StreamState`; `null` is the cold-error
 * routing signal, which `loader.tsx` handles by rendering the `errorFallback`
 * instead of the children.
 */
export type LoaderData = LoaderState<unknown> | StreamState<unknown> | null;

/**
 * The single channel every loader consumer reads. It carries `LoaderData` as a
 * SIGNAL, not a snapshot: `ViewRenderer` reads `.value` directly and `useData()`
 * reads a derived projection of it, so a consumer re-renders on the loader's own
 * state change rather than on a context re-provision. Nothing re-projects the
 * union (that dropped the discriminant, review #1/#6/#7); the discriminant on
 * context is authoritative.
 *
 * Always provided through `LoaderDataProvider`, which owns the invariant this
 * type cannot express: the signal's IDENTITY is stable for the provider's
 * lifetime, because `useData()` memoizes its derived signal on first render.
 */
export const LoaderDataContext =
  createContext<ReadonlySignal<LoaderData> | null>(null);

export const ActiveLoaderIdContext = createContext<symbol | null>(null);

export const LoaderErrorContext = createContext<Error | null>(null);

/**
 * The runner's COLLECT-mode state for a live loader hosted for `useData`
 * (not `.View` accumulate): the retained chunk log plus status/error, as
 * reactive signals. `loader.tsx` provides this when the host runs collect-mode;
 * the live `useData(initial, reduce)` arm in `define-loader.ts` reads it and
 * folds the log through the caller's `reduce`. `null` outside a collect host,
 * which is how `useData`'s live arm detects a missing host and throws.
 */
export type LoaderStreamValue = CollectView;
export const LoaderStreamContext = createContext<LoaderStreamValue | null>(
  null
);
