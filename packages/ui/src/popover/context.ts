// packages/ui/src/popover/context.ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { Side, Align } from '../use-position.js';

export interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>; // the Positioner element
  popupRef: RefObject<HTMLElement>; // the Popup element (focus target)
  triggerId: string;
  popupId: string;
  titleId: string;
  descriptionId: string;
  hasDescription: boolean;
  registerDescription: () => () => void;
  side: Side;
  align: Align;
  offset: number;
}

export const PopoverContext = createContext<PopoverContextValue | null>(null);

export function usePopoverContext(part: string): PopoverContextValue {
  const ctx = useContext(PopoverContext);
  if (!ctx) {
    throw new Error(`<Popover.${part}> must be used within <Popover.Root>`);
  }
  return ctx;
}
