import type { ComponentChildren, VNode } from 'preact';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'preact/hooks';
import {
  toastStore,
  type ToastPosition,
  type ToastRecord,
} from './toast-store.js';
import { ToasterContext } from './context.js';
import {
  ToastAnnouncer,
  useAnnouncer,
  announcementText,
} from './announcer.js';

export interface ToasterProps {
  position?: ToastPosition;
  label?: string;
  gap?: number;
  visibleToasts?: number;
  expand?: boolean;
  hotkey?: string[]; // wired in Task 7
  children: (toast: ToastRecord) => ComponentChildren;
}

// Subscribe to the store with a force-update; no preact/compat.
function useStoreToasts(): ToastRecord[] {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => toastStore.subscribe(force), []);
  return toastStore.toasts;
}

export function Toaster(props: ToasterProps): VNode {
  const {
    position = 'bottom-right',
    label = 'Notifications',
    gap = 14,
    visibleToasts = 3,
    expand = false,
    children,
  } = props;

  const toasts = useStoreToasts();
  const regionRef = useRef<HTMLElement | null>(null);
  const { politeRef, assertiveRef, announce } = useAnnouncer();

  // Promote the region to the top layer. Guarded for the happy-dom test env,
  // which may not implement the Popover API; production browsers always do.
  useEffect(() => {
    const el = regionRef.current;
    if (el && typeof el.showPopover === 'function' && !el.matches(':popover-open')) {
      el.showPopover();
    }
  }, []);

  // Announce each newly-added toast exactly once.
  const announced = useRef(new Set<string | number>());
  useEffect(() => {
    for (const t of toasts) {
      if (t.dismissed || announced.current.has(t.id)) continue;
      announced.current.add(t.id);
      announce(announcementText(t), t.important);
    }
    // Forget ids that have left so a reused id can re-announce.
    const live = new Set(toasts.map((t) => t.id));
    for (const id of announced.current) {
      if (!live.has(id)) announced.current.delete(id);
    }
  }, [toasts, announce]);

  const orderedIds = useMemo(() => toasts.map((t) => t.id), [toasts]);
  const heights = useRef(new Map<string | number, number>()).current;
  const registerHeight = useCallback(
    (_id: string | number, _height: number) => {
      // No-op until Task 9.
    },
    []
  );

  const ctx = useMemo(
    () => ({
      position,
      gap,
      visibleToasts,
      expanded: expand,
      paused: false,
      orderedIds,
      heights,
      registerHeight,
    }),
    [position, gap, visibleToasts, expand, orderedIds, heights, registerHeight]
  );

  return (
    <ToasterContext.Provider value={ctx}>
      <section
        ref={regionRef}
        popover="manual"
        role="region"
        aria-label={label}
        data-position={position}
        tabIndex={-1}
      >
        <ToastAnnouncer politeRef={politeRef} assertiveRef={assertiveRef} />
        <ol>
          {toasts.map((t) => (
            <li key={t.id}>{children(t)}</li>
          ))}
        </ol>
      </section>
    </ToasterContext.Provider>
  );
}
