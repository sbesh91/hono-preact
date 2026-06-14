// packages/ui/src/tooltip/context.ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { Side, Align } from '../use-position.js';

export interface TooltipContextValue {
  open: boolean;
  // open/close go through delayed schedulers; `immediate` skips the timers
  // (used by focus/blur and Escape).
  scheduleOpen: () => void;
  setOpenImmediate: (open: boolean) => void;
  cancelPending: () => void;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  popupId: string;
  side: Side;
  align: Align;
  offset: number;
  closeDelay: number; // grace window for the safe corridor
}

export const TooltipContext = createContext<TooltipContextValue | null>(null);

export function useTooltipContext(part: string): TooltipContextValue {
  const ctx = useContext(TooltipContext);
  if (!ctx) {
    throw new Error(`<Tooltip.${part}> must be used within <Tooltip.Root>`);
  }
  return ctx;
}
