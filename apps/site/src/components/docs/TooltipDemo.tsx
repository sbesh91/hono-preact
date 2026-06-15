import { Tooltip } from 'hono-preact-ui';
import { useState } from 'preact/hooks';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const ALIGNS = ['start', 'center', 'end'] as const;

// Placement explorer: pick a side and alignment, then hover (or focus) the
// trigger to see the tooltip appear there. Styling is in root.css
// (.docs-tooltip* / .docs-placement*).
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
        <Tooltip.Root side={side} align={align}>
          <Tooltip.Trigger class="docs-tooltip-trigger">
            Hover me
          </Tooltip.Trigger>
          <Tooltip.Positioner class="docs-tooltip-positioner">
            <Tooltip.Popup class="docs-tooltip">
              <Tooltip.Arrow class="docs-tooltip__arrow" />
              Saved to your library
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Root>
      </div>
    </div>
  );
}
