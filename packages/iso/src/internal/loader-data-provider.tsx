import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { LoaderDataContext, type LoaderData } from './contexts.js';
import { createPhaseCell } from './loader-signal.js';
import type { PhaseCell } from './reactive.js';

/**
 * Puts one loader's projected consumption union on `LoaderDataContext` as a
 * signal, and owns the two properties every provision site needs:
 *
 *  - The signal's IDENTITY is stable for this provider's lifetime. A ref-held
 *    cell is created on the first render and WRITTEN on every subsequent one,
 *    rather than a fresh signal being handed down each render. Consumers
 *    memoize their projection off the provided signal on first read
 *    (`readDataSignal` in `define-loader.ts` holds its derived signal in a
 *    `useRef`), so a fresh identity per render would freeze every consumer at
 *    the first value.
 *  - An unchanged state is a no-op. `LoaderHost` memoizes the union it passes
 *    in, so an unchanged render writes the SAME reference and the signal skips
 *    the notify.
 *
 * Every site that puts loader data on context goes through here (`LoaderHost`
 * on the client, `DataReader` on the server, `OptimisticOverlay` when it
 * rewrites the data), so a provision site cannot get the identity contract
 * subtly wrong on its own.
 */
export function LoaderDataProvider({
  state,
  children,
}: {
  state: LoaderData;
  children: ComponentChildren;
}) {
  const cellRef = useRef<PhaseCell<LoaderData> | null>(null);
  if (cellRef.current === null) {
    cellRef.current = createPhaseCell<LoaderData>(state);
  } else {
    cellRef.current.set(state);
  }
  return (
    <LoaderDataContext.Provider value={cellRef.current.source}>
      {children}
    </LoaderDataContext.Provider>
  );
}
