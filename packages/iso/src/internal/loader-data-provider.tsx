import type { ComponentChildren } from 'preact';
import { useSignal } from '@preact/signals';
import { LoaderDataContext, type LoaderData } from './contexts.js';
import { publish } from './publish.js';
import { shallowEqual } from './shallow-equal.js';

/**
 * Are these two arms equivalent to a consumer? Same status, and data that
 * matches one level deep.
 *
 * The depth is the whole point. A generic one-level compare of the ARM tests
 * `data` by identity, and `data` is exactly what a re-projection rebuilds, so
 * it would never dedupe the case this exists for. Comparing one level INTO
 * `data` is what makes a re-`reduce` over unchanged input inert.
 */
function sameLoaderData(a: LoaderData, b: LoaderData): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.status !== b.status) return false;
  const aData = 'data' in a ? a.data : undefined;
  const bData = 'data' in b ? b.data : undefined;
  if (!shallowEqual(aData, bData)) return false;
  const aErr = 'error' in a ? a.error : undefined;
  const bErr = 'error' in b ? b.error : undefined;
  return aErr === bErr;
}

/**
 * Puts one loader's projected consumption union on `LoaderDataContext` as a
 * signal, and owns the two properties every provision site needs:
 *
 *  - The signal's IDENTITY is stable for this provider's lifetime. `useSignal`
 *    creates the cell on the first render and every later render WRITES it,
 *    rather than a fresh signal being handed down each render. Consumers
 *    memoize their projection off the provided signal on first read
 *    (`readDataSignal` in `define-loader.ts` reads it inside a `useComputed`),
 *    so a fresh identity per render would freeze every consumer at the first
 *    value.
 *  - An unchanged state is a no-op, ENFORCED here rather than delegated. The
 *    write goes through `publish` with an arm-aware comparator, so handing this
 *    an equivalent-but-fresh arm wakes nobody.
 *
 * Every site that puts loader data on context goes through here (`LoaderHost`
 * on the client, `DataReader` on the server, `OptimisticOverlay` when it
 * rewrites the data), so neither property can be got wrong by a caller.
 *
 * The second one used to be a convention: this wrote whatever it was handed and
 * relied on every caller memoizing. `OptimisticOverlay` broke it, publishing a
 * fresh arm on every render whenever anything was pending and waking every
 * consumer below it, and nothing failed, because over-notifying costs renders
 * and never correctness. Callers may still memoize (`LoaderHost` does, which
 * saves building the arm at all); they no longer have to for correctness of the
 * notify. See #361.
 */
export function LoaderDataProvider({
  state,
  children,
}: {
  state: LoaderData;
  children: ComponentChildren;
}) {
  const cell = useSignal<LoaderData>(state);
  publish(cell, state, sameLoaderData);
  return (
    <LoaderDataContext.Provider value={cell}>
      {children}
    </LoaderDataContext.Provider>
  );
}
