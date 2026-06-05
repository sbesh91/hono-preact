// packages/ui/src/use-dismiss.ts
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { registerDismissLayer, type DismissReason } from './dismiss-stack.js';

export interface UseDismissOptions {
  enabled: boolean; // typically the open state
  refs: Array<RefObject<HTMLElement>>; // stable RefObjects treated as "inside"
  escape?: boolean; // default true
  outsidePress?: boolean; // default true
  // Dismiss-tree node id for menus. Omitted = single-node layer (Popover/Tooltip).
  id?: string;
  // Parent menu's id for submenu coordination. Omitted = tree root.
  parentId?: string | null;
  onDismiss: (reason: DismissReason) => void;
}

export function useDismiss(opts: UseDismissOptions): void {
  const { enabled, refs, escape = true, outsidePress = true, id, parentId, onDismiss } = opts;

  // Forward to the latest onDismiss without re-registering the layer.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // refs are stable RefObjects (from context); capture them in a ref so the
  // effect does not re-run on the array literal's changing identity.
  const refsRef = useRef(refs);
  refsRef.current = refs;

  // Layout effect (not passive) so the layer is registered in the same commit
  // that mounts/opens the overlay, matching useFocusReturn's timing. Otherwise
  // an Escape pressed in the frame before the passive effect runs is missed.
  useLayoutEffect(() => {
    if (!enabled) return;
    return registerDismissLayer({
      refs: refsRef.current,
      escape,
      outsidePress,
      id,
      parentId,
      onDismiss: (reason) => onDismissRef.current(reason),
    });
  }, [enabled, escape, outsidePress, id, parentId]);
}
