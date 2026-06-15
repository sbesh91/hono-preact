import { useDismiss, useFocusReturn } from 'hono-preact-ui';
import { useRef, useState } from 'preact/hooks';

// When the panel opens, useFocusReturn moves focus to its first button; when it
// closes, focus returns to the trigger. Paired with useDismiss so Escape closes
// it (useFocusReturn is not a focus trap). Styling: .docs-focusreturn* in root.css.
export function UseFocusReturnDemo() {
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useFocusReturn({ open, popupRef });
  useDismiss({
    enabled: open,
    refs: [popupRef],
    onDismiss: () => setOpen(false),
  });

  return (
    <div class="docs-focusreturn">
      <button
        type="button"
        class="docs-focusreturn-trigger"
        onClick={() => setOpen(true)}
      >
        Open (focus moves in)
      </button>
      {open ? (
        <div
          ref={popupRef}
          class="docs-focusreturn-panel"
          role="dialog"
          aria-label="Focus panel"
        >
          <p>Focus jumped to the first button.</p>
          <button type="button" onClick={() => setOpen(false)}>
            First
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Second
          </button>
        </div>
      ) : null}
      <p class="docs-focusreturn-hint">
        Close it (Escape or a button) and focus returns to the trigger.
      </p>
    </div>
  );
}
