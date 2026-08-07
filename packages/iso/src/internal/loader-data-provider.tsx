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
 * rewrites the data).
 *
 * NOTE what that does and does not buy. The signal's IDENTITY is owned here, so
 * no caller can get that wrong. The no-op-on-unchanged property is NOT: this
 * writes whatever it is handed, so it holds only as long as every caller passes
 * a stable reference for an unchanged state. That is a convention, not an
 * invariant, and it has already been broken once (`OptimisticOverlay` published
 * a fresh arm on every render whenever anything was pending, waking every
 * consumer below it). `LoaderHost` memoizes its union, `DataReader` renders
 * once on the server, and the overlay now retains its last arm. Moving the
 * comparison in here so a caller cannot forget it is tracked in #361.
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
