// packages/ui/src/menu/navigation.ts
import { getItems } from '../list-navigation.js';
export { wrapNext, wrapPrev, matchTypeahead } from '../list-navigation.js';

// Navigable menu item roles carry data-menu-item; disabled items set
// aria-disabled="true" and are excluded.
export const ITEM_SELECTOR = '[data-menu-item]:not([aria-disabled="true"])';

// Enabled menu items belonging to exactly this surface (a submenu's items are
// scoped out via their closer [role="menu"]).
export function getMenuItems(surface: HTMLElement): HTMLElement[] {
  return getItems(surface, ITEM_SELECTOR, '[role="menu"]');
}
