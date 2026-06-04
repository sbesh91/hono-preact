// packages/ui/src/use-dismiss.ts
import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  registerDismissLayer,
  type DismissReason,
} from './dismiss-stack.js';

export interface UseDismissOptions {
  enabled: boolean; // typically the open state
  refs: Array<RefObject<HTMLElement>>; // stable RefObjects treated as "inside"
  escape?: boolean; // default true
  outsidePress?: boolean; // default true
  onDismiss: (reason: DismissReason) => void;
}

export function useDismiss(opts: UseDismissOptions): void {
  const { enabled, refs, escape = true, outsidePress = true, onDismiss } = opts;

  // Forward to the latest onDismiss without re-registering the layer.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // refs are stable RefObjects (from context); capture them in a ref so the
  // effect does not re-run on the array literal's changing identity.
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!enabled) return;
    return registerDismissLayer({
      refs: refsRef.current,
      escape,
      outsidePress,
      onDismiss: (reason) => onDismissRef.current(reason),
    });
  }, [enabled, escape, outsidePress]);
}
