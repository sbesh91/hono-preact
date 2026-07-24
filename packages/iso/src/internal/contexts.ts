import type { Context } from 'hono';
import { createContext } from 'preact';
import type { LoaderState, StreamState } from '../loader-state.js';

export const HonoRequestContext = createContext<{ context?: Context }>({});

export const LoaderIdContext = createContext<string | null>(null);

// Carries the PROJECTED public union, computed once in `loader.tsx` (and on the
// server in `DataReader`). A non-live loader provides a `LoaderState`; a live
// loader provides a `StreamState`. `ViewRenderer` and `useData()` read this
// directly rather than re-projecting (which dropped the discriminant, review
// #1/#6/#7).
export const LoaderDataContext = createContext<
  LoaderState<unknown> | StreamState<unknown> | null
>(null);

/**
 * The loader's projected `LoaderState` as a reactive value, provided alongside
 * `LoaderDataContext`. `useDataSignal()` reads it: in signal mode it is the
 * host's phase-cell source (granular); in default mode / on the server it is a
 * plain `{ value }` snapshot. Structurally typed so core names no signal. */
export const LoaderViewSignalContext = createContext<{
  readonly value: unknown;
} | null>(null);

export const ActiveLoaderIdContext = createContext<symbol | null>(null);

export const LoaderErrorContext = createContext<Error | null>(null);
