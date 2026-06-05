// packages/ui/src/menu/context.ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type {
  Side,
  Align,
  PositionState,
  ClientRectGetter,
} from '../use-position.js';

export interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  // Close the entire menu tree (root). On a submenu this is the parent's
  // closeAll, so item activation anywhere collapses the whole menu.
  closeAll: () => void;
  // Dismiss-tree identity.
  dismissId: string;
  parentDismissId: string | null;
  anchorRef: RefObject<HTMLElement>; // trigger (Menu) or unused (ContextMenu)
  floatingRef: RefObject<HTMLElement>; // Positioner element
  popupRef: RefObject<HTMLElement>; // Popup surface (focus + nav root)
  arrowRef: RefObject<HTMLElement>;
  triggerId: string;
  popupId: string;
  // Roving tabindex: the id of the active item (null until open focuses one).
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  // Which edge to focus when the menu opens ('first' default, 'last' on ArrowUp).
  pendingEdgeRef: RefObject<'first' | 'last'>;
  side: Side;
  align: Align;
  offset: number;
  loop: boolean;
  typeahead: boolean;
  position: PositionState;
  setPosition: (p: PositionState) => void;
  // Context menu only: positions at the pointer. Undefined for Menu.
  getAnchorRect?: ClientRectGetter;
}

export const MenuContext = createContext<MenuContextValue | null>(null);

export function useMenuContext(part: string): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) {
    throw new Error(
      `<Menu.${part}> must be used within <Menu.Root> or <ContextMenu.Root>`
    );
  }
  return ctx;
}

// Per-RadioGroup selection context.
export interface MenuRadioGroupContextValue {
  value: string | undefined;
  setValue: (value: string) => void;
}
export const MenuRadioGroupContext =
  createContext<MenuRadioGroupContextValue | null>(null);
export function useMenuRadioGroupContext(): MenuRadioGroupContextValue {
  const ctx = useContext(MenuRadioGroupContext);
  if (!ctx) {
    throw new Error('<Menu.RadioItem> must be used within <Menu.RadioGroup>');
  }
  return ctx;
}
