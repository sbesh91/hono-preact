import { Fragment } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { useRef } from 'preact/hooks';
import type { ReadonlyReactive } from './internal/reactive.js';

export type ForProps<T> = {
  /** A reactive array. Read as a signal, so `<For>` re-renders when it changes. */
  each: ReadonlyReactive<readonly T[]>;
  /** Derive a stable, unique key per item. Defaults to the item itself
   * (identity), which is exact for a `memberIds`-style array of keys. */
  by?: (item: T, index: number) => unknown;
  /** Render one item. Each row runs inside its own component boundary, so a
   * signal read here (inline, e.g. `{member(id).value}`, or via a nested
   * component) subscribes that row and re-renders it alone and fresh. A
   * surviving row is otherwise not re-invoked on a list change, so its `item` /
   * `index` arguments are captured at first render and go stale on reorder;
   * drive changing per-row data through signals, not through those captured
   * arguments. */
  children: (item: T, index: number) => ComponentChildren;
};

// A per-row component boundary. The child render runs HERE, inside a component,
// so a signal read in it subscribes THIS row (which re-renders alone and fresh
// on its own signal), not the parent <For>. This is the key difference from
// calling `children` eagerly: an inline `{sig.value}` in a row stays live.
function Item<T>({
  item,
  index,
  render,
}: {
  item: T;
  index: number;
  render: (item: T, index: number) => ComponentChildren;
}): VNode {
  return <Fragment>{render(item, index)}</Fragment>;
}

/**
 * A keyed list helper. It caches each row's component by key, so a membership
 * change (append / remove / reorder) reconciles by key and mounts a row only
 * for a newly appeared key; a surviving row keeps its cached vnode (same
 * reference), so Preact bails on it. Each row runs inside its own component
 * boundary, so a signal read in the child re-renders that row alone.
 */
export function For<T>({ each, by, children }: ForProps<T>): VNode {
  const cacheRef = useRef<Map<unknown, VNode> | null>(null);
  // Lazy first-render init so later renders do not allocate a throwaway Map
  // (the initializer would otherwise run every render and be discarded).
  const prev = (cacheRef.current ??= new Map());
  const items = each.value; // subscribes <For> to the list signal
  const next = new Map<unknown, VNode>();
  const out: VNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = by ? by(item, i) : item;
    if (next.has(key)) {
      throw new Error(
        `<For>: duplicate key ${String(key)}; keys must be unique.`
      );
    }
    // Reuse the cached row for a surviving key (same reference, so Preact bails
    // on that row); mount a fresh keyed row only for a new key.
    const row = prev.get(key) ?? (
      <Item key={key} item={item} index={i} render={children} />
    );
    next.set(key, row);
    out.push(row);
  }
  cacheRef.current = next; // departed keys fall out of the cache (eviction)
  return <Fragment>{out}</Fragment>;
}
