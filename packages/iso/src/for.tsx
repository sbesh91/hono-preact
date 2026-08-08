import { Fragment } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { useRef } from 'preact/hooks';
import { batch, signal } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';
import { publish } from './internal/publish.js';

export type ForProps<T> = {
  /** A reactive array. Read as a signal, so `<For>` re-renders when it changes. */
  each: ReadonlySignal<readonly T[]>;
  /** Derive a stable, unique key per item. Defaults to the item itself
   * (identity), which is exact for a `memberIds`-style array of keys. Supply
   * `by` whenever items are re-created per payload (e.g. deserialised loader
   * data), or every row remounts on each new array. */
  by?: (item: T, index: number) => unknown;
  /** Render one item. `item` and `index` are per-row signal cells: they are
   * object-stable for as long as the key survives, and their values track the
   * current item and position. Rows re-run with fresh closures whenever the
   * list changes, so nothing captured here can go stale; the cells exist so a
   * row can hand a stable reactive identity to its own subcomponents and
   * effects. */
  children: (
    item: ReadonlySignal<T>,
    index: ReadonlySignal<number>
  ) => ComponentChildren;
};

type RowCells<T> = { item: Signal<T>; index: Signal<number> };

// A readable spelling of a duplicate key for the error message. Objects
// stringify as JSON where possible; String() would collapse every object key
// to "[object Object]", which hides exactly the case most likely to collide.
function formatKey(key: unknown): string {
  if (typeof key === 'object' && key !== null) {
    try {
      return JSON.stringify(key);
    } catch {
      return String(key);
    }
  }
  return String(key);
}

// A per-row component boundary. The child render runs HERE, inside a
// component, so a signal read in it subscribes THIS row (which re-renders
// alone on its own signal), not the parent <For>.
function Item<T>({
  cells,
  render,
}: {
  cells: RowCells<T>;
  render: ForProps<T>['children'];
}): VNode {
  return <Fragment>{render(cells.item, cells.index)}</Fragment>;
}

/**
 * A keyed list helper bound to a signal. Rows reconcile by key, so a surviving
 * key keeps its DOM and component state across membership changes; every list
 * change re-invokes row renders with fresh closures, so captured state is
 * never stale. Each row gets a stable pair of signal cells (`item`, `index`)
 * it can pass to subcomponents or effects for granular, closure-independent
 * updates, and each row runs inside its own component boundary, so an inline
 * signal read re-renders that row alone.
 */
export function For<T>({ each, by, children }: ForProps<T>): VNode {
  const cellsRef = useRef<Map<unknown, RowCells<T>> | null>(null);
  // Lazy first-render init so later renders do not allocate a throwaway Map.
  const prev = (cellsRef.current ??= new Map());
  const items = each.value; // subscribes <For> to the list signal
  // Keys are computed and validated BEFORE any cell is written, so a
  // duplicate-key throw aborts the render without having published anything
  // from it: an error-boundary-recovering tree never sees cells from a render
  // that did not commit.
  const keys: unknown[] = [];
  const seen = new Set<unknown>();
  items.forEach((item, i) => {
    const key = by ? by(item, i) : item;
    if (seen.has(key)) {
      throw new Error(
        `<For>: duplicate key ${formatKey(key)}; keys must be unique.`
      );
    }
    seen.add(key);
    keys.push(key);
  });
  const next = new Map<unknown, RowCells<T>>();
  const out: VNode[] = [];
  // Cell writes are batched so subscribers see one consistent update per list
  // change, not one per row.
  batch(() => {
    items.forEach((item, i) => {
      const key = keys[i];
      let cells = prev.get(key);
      if (cells) {
        // A deserialised payload rebuilds row objects, so an unchanged row
        // arrives as a fresh, deep-equal reference; publish compares contents
        // (shallowEqual) so those writes stay silent. The index is a
        // primitive, so its === dedupe is exact.
        publish(cells.item, item);
        cells.index.value = i;
      } else {
        cells = { item: signal(item), index: signal(i) };
      }
      next.set(key, cells);
      out.push(<Item key={key} cells={cells} render={children} />);
    });
  });
  cellsRef.current = next; // departed keys fall out of the map (eviction)
  return <Fragment>{out}</Fragment>;
}
