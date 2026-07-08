import { useState } from 'preact/hooks';
import { TooltipExample } from './TooltipExample.js';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const ALIGNS = ['start', 'center', 'end'] as const;

// Placement explorer harness around the TooltipExample core. The controls exist
// only here (the docs Code tab shows TooltipExample, the real usage). Styling is
// in docs.css (.docs-tooltip* / .docs-placement*).
export function TooltipDemo() {
  const [side, setSide] = useState<(typeof SIDES)[number]>('top');
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
        <TooltipExample side={side} align={align} />
      </div>
    </div>
  );
}
