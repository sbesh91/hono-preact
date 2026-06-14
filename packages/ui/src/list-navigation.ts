// packages/ui/src/list-navigation.ts
import type { RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { useTypeahead } from './use-typeahead.js';

// --- pure helpers (relocated from menu/navigation.ts) ---

export function wrapNext(
  current: number,
  length: number,
  loop: boolean
): number {
  if (length === 0) return -1;
  const next = current + 1;
  if (next < length) return next;
  return loop ? 0 : length - 1;
}

export function wrapPrev(
  current: number,
  length: number,
  loop: boolean
): number {
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

// Enabled items inside `container` matching `selector`, in DOM order. When
// `scopeSelector` is given, an item nested inside a closer same-role container
// (a submenu) is excluded, so a parent's navigation skips a child's items.
export function getItems(
  container: HTMLElement,
  selector: string,
  scopeSelector?: string
): HTMLElement[] {
  const all = Array.from(container.querySelectorAll<HTMLElement>(selector));
  if (!scopeSelector) return all;
  return all.filter((el) => el.closest(scopeSelector) === container);
}

// --- the hook ---

export type ListNavigationMode = 'roving' | 'activedescendant';

export interface UseListNavigationOptions {
  enabled: boolean;
  containerRef: RefObject<HTMLElement>; // element holding the items
  itemSelector: string;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  mode: ListNavigationMode;
  loop?: boolean; // default true
  typeahead?: boolean; // default true
  homeEnd?: boolean; // handle Home/End (default true); false leaves them native
  scopeSelector?: string; // exclude nested same-role containers (menus)
}

export interface ListNavigation {
  // Handle ArrowUp/Down, Home/End, and typeahead. Calls preventDefault on keys
  // it consumes (so the caller can early-return on event.defaultPrevented).
  onKeyDown: (event: KeyboardEvent) => void;
  // Current enabled items (live DOM query).
  getItems: () => HTMLElement[];
  // Activate the item at `index`: set the active id and, in roving mode, move
  // DOM focus; in activedescendant mode scroll it into view (focus stays put).
  setActiveItem: (index: number) => void;
}

export function useListNavigation(
  opts: UseListNavigationOptions
): ListNavigation {
  const {
    enabled,
    containerRef,
    itemSelector,
    activeId,
    setActiveId,
    mode,
    loop = true,
    typeahead = true,
    homeEnd = true,
    scopeSelector,
  } = opts;
  const runTypeahead = useTypeahead();

  const items = (): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) return [];
    return getItems(container, itemSelector, scopeSelector);
  };

  const activate = (list: HTMLElement[], index: number) => {
    if (index < 0 || index >= list.length) return;
    const el = list[index];
    setActiveId(el.id);
    if (mode === 'roving') {
      el.focus();
    } else {
      el.scrollIntoView({ block: 'nearest' });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!enabled) return;
    const list = items();
    const current = list.findIndex((el) => el.id === activeId);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        activate(list, wrapNext(current, list.length, loop));
        return;
      case 'ArrowUp':
        event.preventDefault();
        activate(list, wrapPrev(current, list.length, loop));
        return;
      case 'Home':
        if (!homeEnd) return;
        event.preventDefault();
        activate(list, 0);
        return;
      case 'End':
        if (!homeEnd) return;
        event.preventDefault();
        activate(list, list.length - 1);
        return;
    }

    // Typeahead: single printable chars, never Space (Space selects/activates
    // in both menu and listbox patterns) and never modifier combos.
    if (
      typeahead &&
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const query = runTypeahead(event.key);
      const labels = list.map((el) => el.textContent ?? '');
      // Start the search after the current item on the first keystroke (repeats
      // cycle); on a refining query start at current-1 so the current item is
      // re-tested first and keeps the active state while it still matches.
      const from = current < 0 ? -1 : current - (query.length > 1 ? 1 : 0);
      const match = matchTypeahead(labels, query, from);
      if (match >= 0) {
        event.preventDefault();
        activate(list, match);
      }
    }
  };

  return {
    onKeyDown,
    getItems: items,
    setActiveItem: (i) => activate(items(), i),
  };
}

// On open, move the active descendant to the selected option (or the first if
// none). Shared by Select.Trigger and Combobox.Input. Deps are [open] only:
// `nav` is recreated every render, so the effect captures it and re-runs only
// when `open` toggles (getItems/setActiveItem read live refs at run time).
export function useHighlightSelectedOnOpen(
  nav: ListNavigation,
  open: boolean
): void {
  useLayoutEffect(() => {
    if (!open) return;
    const list = nav.getItems();
    if (list.length === 0) return;
    const selectedIdx = list.findIndex(
      (el) => el.getAttribute('aria-selected') === 'true'
    );
    nav.setActiveItem(selectedIdx >= 0 ? selectedIdx : 0);
  }, [open]);
}
