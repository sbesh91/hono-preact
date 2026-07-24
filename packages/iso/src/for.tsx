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
  /** Render one item. The result is cached per key, so a surviving row is NOT
   * re-invoked on a list change; read changing state through signals (e.g.
   * `member(id)`), not through captured non-signal props. Because a surviving
   * row is not re-invoked, its captured `index` also goes stale on reorder;
   * children that depend on position rather than identity should account for
   * that. */
  children: (item: T, index: number) => ComponentChildren;
};

/**
 * A keyed list helper. It caches each rendered row by key, so a membership
 * change (append / remove / reorder) reconciles by key and re-invokes the child
 * only for a newly appeared key; a surviving row keeps its cached vnode (same
 * reference), so Preact bails on it. Pair with a per-item signal so an item
 * update re-renders that row alone.
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
    // Reuse the cached vnode for a surviving key (same reference, so Preact
    // bails on that row); build a fresh keyed row only for a new key.
    const row = prev.get(key) ?? (
      <Fragment key={key}>{children(item, i)}</Fragment>
    );
    next.set(key, row);
    out.push(row);
  }
  cacheRef.current = next; // departed keys fall out of the cache (eviction)
  return <Fragment>{out}</Fragment>;
}
