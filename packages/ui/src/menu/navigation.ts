// packages/ui/src/menu/navigation.ts
//
// Pure navigation helpers for the roving-tabindex menu. Index math is fully
// pure; getMenuItems is DOM-only (no Preact).

// Navigable item roles carry data-menu-item; disabled items set
// aria-disabled="true" and are excluded here.
export const ITEM_SELECTOR = '[data-menu-item]:not([aria-disabled="true"])';

export function wrapNext(current: number, length: number, loop: boolean): number {
  if (length === 0) return -1;
  const next = current + 1;
  if (next < length) return next;
  return loop ? 0 : length - 1;
}

export function wrapPrev(current: number, length: number, loop: boolean): number {
  if (length === 0) return -1;
  const prev = current - 1;
  if (prev >= 0) return prev;
  return loop ? length - 1 : 0;
}

// The next item (circularly, starting after fromIndex) whose text begins with
// query. Returns -1 when nothing matches.
export function matchTypeahead(
  labels: string[],
  query: string,
  fromIndex: number
): number {
  const q = query.toLowerCase();
  const n = labels.length;
  for (let step = 1; step <= n; step++) {
    const i = (fromIndex + step) % n;
    if (labels[i].trim().toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

// Enabled items belonging to exactly this surface (not a nested submenu), in
// DOM order. Scoping by closest [role="menu"] keeps a submenu's items out of
// the parent's navigation even though they are DOM descendants.
export function getMenuItems(surface: HTMLElement): HTMLElement[] {
  const all = Array.from(surface.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
  return all.filter((el) => el.closest('[role="menu"]') === surface);
}
