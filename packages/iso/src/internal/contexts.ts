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

export const ActiveLoaderIdContext = createContext<symbol | null>(null);

export const LoaderErrorContext = createContext<Error | null>(null);
