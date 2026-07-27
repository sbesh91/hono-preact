import type { ComponentChildren } from 'preact';
import { useSignal } from '@preact/signals';
import { LoaderDataContext, type LoaderData } from './contexts.js';

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
  const cell = useSignal<LoaderData>(state);
  cell.value = state;
  return (
    <LoaderDataContext.Provider value={cell}>
      {children}
    </LoaderDataContext.Provider>
  );
}
