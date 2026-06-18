import { usePosition } from 'hono-preact-ui';
import { useRef, useState } from 'preact/hooks';

interface UsePositionExampleProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

// Demonstrates usePosition: a button anchors a floating box that tracks it via
// position:fixed. The resolved side/align (after collision handling) is shown
// inside the box. Styling: .docs-useposition* in root.css.
export function UsePositionExample({
  side = 'bottom',
  align = 'center',
}: UsePositionExampleProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const pos = usePosition({ open, anchorRef, floatingRef, side, align });

  return (
    <div class="docs-useposition">
      <button
        ref={anchorRef}
        type="button"
        class="docs-useposition-anchor"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide' : 'Show'} box
      </button>
      {open ? (
        <div
          ref={floatingRef}
          class="docs-useposition-box"
          data-side={pos.side}
          data-align={pos.align}
        >
          resolved: {pos.side} / {pos.align}
        </div>
      ) : null}
    </div>
  );
}
