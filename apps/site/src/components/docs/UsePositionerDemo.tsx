import { usePositioner } from '@hono-preact/ui';
import { useRef, useState } from 'preact/hooks';

// A complete custom anchored overlay built directly on usePositioner: it composes
// floating placement, the open/close presence lifecycle, native top-layer
// promotion (Popover API), and the UA [popover] style resets, so the demo only
// wires open state and side-aware styling. positionerProps already carries the
// merged ref, position style, and data-side/data-align. Styling: .docs-usepositioner*.
export function UsePositionerDemo() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  const { isPresent, positionerProps, state } = usePositioner({
    open,
    anchorRef,
    floatingRef,
    side: 'bottom',
    align: 'center',
    offset: 8,
    mount: 'unmount',
  });

  return (
    <div class="docs-usepositioner">
      <button
        ref={anchorRef}
        type="button"
        class="docs-usepositioner-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Close' : 'Open'} overlay
      </button>
      {isPresent ? (
        <div {...positionerProps}>
          <div class="docs-usepositioner-popup" data-side={state.side}>
            Built on usePositioner, anchored {state.side}.
          </div>
        </div>
      ) : null}
    </div>
  );
}
