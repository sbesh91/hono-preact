import type { Ref } from 'preact';

type AnyRef<T> = Ref<T> | null | undefined;

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
