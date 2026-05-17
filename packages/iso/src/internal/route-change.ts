import { flushSync } from 'preact/compat';

type Sub = (to: string, from: string | undefined) => void;

const subs = new Set<Sub>();

export function __dispatchRouteChange(
  to: string,
  from: string | undefined
): void {
  for (const cb of subs) cb(to, from);

  if (typeof document === 'undefined') return;
  const startViewTransition = (
    document as { startViewTransition?: (cb: () => void) => unknown }
  ).startViewTransition;
  if (typeof startViewTransition !== 'function') return;
  startViewTransition.call(document, () => flushSync(() => {}));
}

export function __subscribeRouteChange(sub: Sub): () => void {
  subs.add(sub);
  return () => {
    subs.delete(sub);
  };
}
