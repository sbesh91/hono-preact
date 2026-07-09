import { useDismiss, type DismissReason } from 'hono-preact-ui';
import { useRef, useState } from 'preact/hooks';

// A panel registered with the dismissal stack. Pressing Escape or clicking
// outside the panel dismisses it; the readout shows which path fired.
// Styling: .docs-dismiss* in docs.css.
export function UseDismissDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DismissReason | null>(null);

  useDismiss({
    enabled: open,
    refs: [ref],
    onDismiss: (r) => {
      setReason(r);
      setOpen(false);
    },
  });

  return (
    <div class="docs-dismiss">
      <button
        type="button"
        class="docs-dismiss-trigger"
        onClick={() => {
          setReason(null);
          setOpen(true);
        }}
      >
        Open panel
      </button>
      {open ? (
        <div
          ref={ref}
          class="docs-dismiss-panel"
          role="dialog"
          aria-label="Dismissable panel"
        >
          Press Escape or click outside to dismiss.
        </div>
      ) : null}
      {reason ? (
        <p class="docs-dismiss-readout">
          dismissed via: <strong>{reason}</strong>
        </p>
      ) : null}
    </div>
  );
}
