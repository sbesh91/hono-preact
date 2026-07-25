import type { Context } from 'hono';
import { createContext } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import type {
  LoaderState,
  StreamState,
  StreamStatus,
} from '../loader-state.js';

export const HonoRequestContext = createContext<{ context?: Context }>({});

export const LoaderIdContext = createContext<string | null>(null);

// Carries the PROJECTED public union, computed once in `loader.tsx` (and on the
// server in `DataReader`). A non-live loader provides a `LoaderState`; a live
// loader provides a `StreamState`. `ViewRenderer` reads this directly rather
// than re-projecting (which dropped the discriminant, review #1/#6/#7).
// `useData()` reads the sibling `LoaderViewSignalContext` (a signal), not this.
export const LoaderDataContext = createContext<
  LoaderState<unknown> | StreamState<unknown> | null
>(null);

/**
 * The loader's projected `LoaderState` as a reactive value, provided alongside
 * `LoaderDataContext`. `useData()` reads it: in signal mode it is the host's
 * phase-cell source (granular); in default mode / on the server it is a
 * plain `{ value }` snapshot. Structurally typed so core names no signal. */
export const LoaderViewSignalContext = createContext<{
  readonly value: unknown;
} | null>(null);

export const ActiveLoaderIdContext = createContext<symbol | null>(null);

export const LoaderErrorContext = createContext<Error | null>(null);

/**
 * The runner's COLLECT-mode state for a live loader hosted for `useData`
 * (not `.View` accumulate): the retained chunk log plus status/error, as
 * reactive signals. `loader.tsx` provides this when the host runs collect-mode;
 * the live `useData(initial, reduce)` arm in `define-loader.ts` reads it and
 * folds `chunks` through the caller's `reduce`. `null` outside a collect host,
 * which is how `useData`'s live arm detects a missing host and throws.
 */
export type LoaderStreamValue = {
  chunks: ReadonlySignal<readonly unknown[]>;
  status: ReadonlySignal<StreamStatus>;
  error: ReadonlySignal<Error | null>;
  /**
   * Monotonic generation counter, bumped on every fresh subscription (initial
   * mount or a reload). `useData`'s live arm threads this into `foldStream` so
   * a fold created before a reset detects the reset and refolds the new
   * stream from scratch, instead of stale-continuing onto the prior stream's
   * accumulator.
   */
  epoch: ReadonlySignal<number>;
};
export const LoaderStreamContext = createContext<LoaderStreamValue | null>(
  null
);
