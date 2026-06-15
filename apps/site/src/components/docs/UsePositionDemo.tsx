import { usePosition } from 'hono-preact-ui';
import { useRef, useState } from 'preact/hooks';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const ALIGNS = ['start', 'center', 'end'] as const;

// Bare placement: usePosition anchors the floating box to the button and applies
// position:fixed/left/top itself, resolving a final side/align after collision
// handling (the readout shows the resolved values, which can differ from the
// requested side near a viewport edge). Deliberately not a popover. Styling:
// .docs-useposition* in root.css.
export function UsePositionDemo() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<(typeof SIDES)[number]>('bottom');
  const [align, setAlign] = useState<(typeof ALIGNS)[number]>('center');

  const pos = usePosition({ open, anchorRef, floatingRef, side, align });

  return (
    <div class="docs-useposition">
      <div class="docs-useposition-controls">
        <fieldset class="docs-useposition-group">
          <legend>side</legend>
          {SIDES.map((s) => (
            <label key={s}>
              <input
                type="radio"
                name="docs-useposition-side"
                checked={s === side}
                onChange={() => setSide(s)}
              />
              {s}
            </label>
          ))}
        </fieldset>
        <fieldset class="docs-useposition-group">
          <legend>align</legend>
          {ALIGNS.map((a) => (
            <label key={a}>
              <input
                type="radio"
                name="docs-useposition-align"
                checked={a === align}
                onChange={() => setAlign(a)}
              />
              {a}
            </label>
          ))}
        </fieldset>
      </div>
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
