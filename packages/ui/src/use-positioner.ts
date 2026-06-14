import type { JSX, RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { usePosition } from './use-position.js';
import type {
  Side,
  Align,
  PositionState,
  ClientRectGetter,
} from './use-position.js';
import { usePresence } from './use-presence.js';
import { mergeRefs } from './merge-refs.js';

// The framework-owned layout wrapper's style. Besides positioning, it
// neutralizes the UA [popover] rule that applies once the element is promoted
// to the top layer (overflow/inset/margin/border/padding/background): without
// this the UA `overflow: auto` clips the popup's box-shadow and `inset: 0`
// fights the computed left/top. One stable reference (shared by all 5).
const POSITIONER_STYLE: JSX.CSSProperties = {
  position: 'fixed',
  inset: 'auto',
  margin: 0,
  overflow: 'visible',
  border: 0,
  padding: 0,
  background: 'transparent',
};

export interface UsePositionerOptions {
  open: boolean;
  // The element the overlay is positioned against.
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  // Optional during the migration to PositionerContext: when omitted the hook
  // creates and owns the ref. Removed once every component stops passing it.
  arrowRef?: RefObject<HTMLElement>;
  side: Side;
  align: Align;
  offset: number;
  // Position against a point or virtual element instead of anchorRef (e.g. a
  // pointer position). Undefined for the common anchor-element case.
  getAnchorRect?: ClientRectGetter;
  // Optional legacy publish hook (pre-PositionerContext); removed once every
  // component reads the position from the hook return instead.
  setPosition?: (p: PositionState) => void;
  // 'unmount': the component returns null while closed (branch on isPresent).
  // 'hidden': the element stays mounted (so options can register their labels)
  // and is `hidden` while closed.
  mount: 'unmount' | 'hidden';
}

export interface PositionerProps {
  ref: (node: HTMLElement | null) => void;
  hidden?: true;
  'data-side': Side;
  'data-align': Align;
  style: JSX.CSSProperties;
}

export interface UsePositionerResult {
  // Raw presence value. 'unmount' components branch on this (`return null`);
  // 'hidden' components ignore it (the hook bakes `hidden` into the props).
  isPresent: boolean;
  positionerProps: PositionerProps;
  state: { side: Side; align: Align };
  // The resolved position, for a Positioner to publish via PositionerContext.
  position: PositionState;
  // The ref floating-ui measures and the Arrow attaches to.
  arrowRef: RefObject<HTMLElement>;
}

export function usePositioner(opts: UsePositionerOptions): UsePositionerResult {
  const presence = usePresence(opts.open);

  const ownArrowRef = useRef<HTMLElement>(null);
  const arrowRef = opts.arrowRef ?? ownArrowRef;

  const position = usePosition({
    open: presence.isPresent,
    anchorRef: opts.anchorRef,
    floatingRef: opts.floatingRef,
    arrowRef,
    side: opts.side,
    align: opts.align,
    offset: opts.offset,
    getAnchorRect: opts.getAnchorRect,
  });

  // Legacy publish to the Root (back-compat during migration). No-op once a
  // component reads `position` from this hook's return instead.
  useLayoutEffect(() => {
    opts.setPosition?.(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);

  // Promote to the native top layer. The Popover API is a hard dependency of
  // these components; on a browser without it showPopover() throws (no
  // fallback). Applied imperatively so there is no SSR/hydration mismatch, and
  // it stays mounted through the exit animation so hidePopover fires only after
  // the closing transition completes.
  useLayoutEffect(() => {
    const el = opts.floatingRef.current;
    if (!presence.isPresent || !el) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      // Best-effort un-promotion: hidePopover() throws if the element already
      // left the top layer (closed by another path or disconnected). Either way
      // the goal state (not promoted) is met, so ignore the throw.
      try {
        el.hidePopover();
      } catch {
        // already hidden / disconnected
      }
      el.removeAttribute('popover');
    };
  }, [presence.isPresent]);

  return {
    isPresent: presence.isPresent,
    positionerProps: {
      ref: mergeRefs(opts.floatingRef, presence.ref),
      hidden: opts.mount === 'hidden' && !presence.isPresent ? true : undefined,
      'data-side': position.side,
      'data-align': position.align,
      style: POSITIONER_STYLE,
    },
    state: { side: position.side, align: position.align },
    position,
    arrowRef,
  };
}
