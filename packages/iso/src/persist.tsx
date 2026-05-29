import type { ComponentChildren, VNode } from 'preact';
import { Fragment, h } from 'preact';
import { useLayoutEffect, useReducer } from 'preact/hooks';
import {
  __persistRegistryWrite,
  __persistRegistryRead,
  __persistRegistrySubscribe,
  type PersistEntry,
} from './internal/persist-registry.js';
import { useViewTransitionName } from './view-transition-name.js';
import { isBrowser } from './is-browser.js';

export interface PersistProps {
  id: string;
  viewTransitionName?: string;
  children?: ComponentChildren;
}

export function Persist(props: PersistProps): VNode {
  const browser = isBrowser();

  // Hook is called unconditionally. The effect short-circuits on the server,
  // so SSR's render output (children inline) remains the only side effect.
  // No deps array: runs after every render so children/viewTransitionName
  // updates flow through without stale captures.
  useLayoutEffect(() => {
    if (!browser) return;
    const entry: PersistEntry = {
      children: props.children,
      viewTransitionName: props.viewTransitionName,
    };
    __persistRegistryWrite(props.id, entry);
    // Intentionally no cleanup: Persist does NOT clear the registry on unmount.
    // Keeping the last-known children lets PersistHost continue to render
    // across route changes where Persist temporarily disappears.
  });

  // SSR renders children inline so first paint matches steady state;
  // the client renders nothing inline because PersistHost owns the DOM.
  return browser ? h(Fragment, null) : h(Fragment, null, props.children);
}

Persist.displayName = 'Persist';

interface PersistSlotProps {
  id: string;
  entry: PersistEntry;
}

function PersistSlot(props: PersistSlotProps): VNode {
  const ref = useViewTransitionName(props.entry.viewTransitionName);
  return (
    <div data-hp-persist-slot={props.id} ref={ref}>
      {props.entry.children}
    </div>
  );
}

PersistSlot.displayName = 'PersistSlot';

export function PersistHost(): VNode {
  // useReducer instead of useState: guarantees a re-render on each dispatch
  // even if an intermediate render has already drained the "new" state.
  // This matters for the ordering race: Persist's useLayoutEffect may run
  // either before or after PersistHost's. Using useReducer ensures the
  // forced tick after subscribe always queues a fresh render regardless of
  // React/Preact batching.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // useLayoutEffect (not useEffect) so the subscription is in place before
  // sibling effects run. The immediate forceUpdate after subscribe re-reads
  // the registry to catch any Persist sibling whose useLayoutEffect already
  // wrote between PersistHost's render and this subscribe call (sibling order
  // is render order, but effect order can differ per host).
  useLayoutEffect(() => {
    const unsub = __persistRegistrySubscribe(() => forceUpdate(undefined));
    forceUpdate(undefined);
    return unsub;
  }, []);

  const map = __persistRegistryRead();
  return (
    <Fragment>
      {Array.from(map.entries()).map(([id, entry]) => (
        <PersistSlot key={id} id={id} entry={entry} />
      ))}
    </Fragment>
  );
}

PersistHost.displayName = 'PersistHost';
