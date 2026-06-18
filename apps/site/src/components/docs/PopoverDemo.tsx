import { useState } from 'preact/hooks';
import { PopoverExample } from './PopoverExample.js';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const ALIGNS = ['start', 'center', 'end'] as const;

// Placement explorer harness around the PopoverExample core. The controls live
// outside the popover so the core can be driven by props. The Code tab shows
// PopoverExample, the real usage. Styling: .docs-placement* in root.css.
export function PopoverDemo() {
  const [side, setSide] = useState<(typeof SIDES)[number]>('bottom');
  const [align, setAlign] = useState<(typeof ALIGNS)[number]>('center');
  return (
    <div class="docs-placement">
      <div class="docs-placement__controls">
        <div class="docs-placement__group" role="group" aria-label="Side">
          {SIDES.map((s) => (
            <button
              key={s}
              type="button"
              class="docs-placement__option"
              data-active={s === side}
              onClick={() => setSide(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div class="docs-placement__group" role="group" aria-label="Align">
          {ALIGNS.map((a) => (
            <button
              key={a}
              type="button"
              class="docs-placement__option"
              data-active={a === align}
              onClick={() => setAlign(a)}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <div class="docs-placement__stage">
        <PopoverExample side={side} align={align} />
      </div>
    </div>
  );
}
