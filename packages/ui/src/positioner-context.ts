import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { PositionState } from './use-position.js';

// Provided by each component's Positioner part, consumed by the shared Arrow.
// Small sibling context in the spirit of SelectOptionGroupContext: it carries
// only what the Arrow needs (the resolved position + the ref it attaches to),
// so position changes no longer invalidate the component's main context.
export interface PositionerContextValue {
  position: PositionState;
  arrowRef: RefObject<HTMLElement>;
}

export const PositionerContext = createContext<PositionerContextValue | null>(
  null
);

export function usePositionerContext(): PositionerContextValue {
  const ctx = useContext(PositionerContext);
  if (!ctx) {
    throw new Error('<Arrow> must be rendered inside a Positioner');
  }
  return ctx;
}
