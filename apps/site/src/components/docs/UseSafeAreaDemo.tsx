import { useSafeArea } from 'hono-preact-ui';
import { useRef, useState } from 'preact/hooks';

// A hover-opened card sitting across a diagonal gap from its trigger. useSafeArea
// keeps it open while the pointer travels the corridor toward it, even on a
// diagonal that does not aim straight at the card, and closes it after the grace
// period once the pointer leaves the safe region. The card is CSS-placed to the
// lower-right with a deliberate gap. Styling: .docs-safearea* in docs.css.
export function UseSafeAreaDemo() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useSafeArea({
    enabled: open,
    anchorRef,
    floatingRef,
    onClose: () => setOpen(false),
  });

  return (
    <div class="docs-safearea">
      <button
        ref={anchorRef}
        type="button"
        class="docs-safearea-trigger"
        onPointerEnter={() => setOpen(true)}
      >
        Hover me
      </button>
      {open ? (
        <div
          ref={floatingRef}
          class="docs-safearea-card"
          role="group"
          aria-label="Hover card"
        >
          Move diagonally here. The corridor keeps me open across the gap; leave
          it and I close after a moment.
        </div>
      ) : null}
    </div>
  );
}
