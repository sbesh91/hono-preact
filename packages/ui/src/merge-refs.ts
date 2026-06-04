import type { Ref } from 'preact';

type AnyRef<T> = Ref<T> | null | undefined;

// Combine several refs into one callback ref. Function refs are invoked with
// the node; object refs have `.current` assigned; null/undefined are skipped.
export function mergeRefs<T>(...refs: AnyRef<T>[]): (node: T | null) => void {
  return (node: T | null) => {
    for (const ref of refs) {
      if (ref == null) continue;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as { current: T | null }).current = node;
      }
    }
  };
}
