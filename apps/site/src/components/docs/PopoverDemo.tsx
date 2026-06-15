import { Popover } from 'hono-preact-ui';
import { useState } from 'preact/hooks';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const ALIGNS = ['start', 'center', 'end'] as const;

// Interactive placement explorer. The side/align controls live INSIDE the popup
// on purpose: a click inside the popover is not an outside-press, so the popover
// stays open and repositions live as you change them. Styling is in root.css
// (.docs-popover* / .docs-placement*).
export function PopoverDemo() {
  const [side, setSide] = useState<(typeof SIDES)[number]>('bottom');
  const [align, setAlign] = useState<(typeof ALIGNS)[number]>('center');
  return (
    <Popover.Root side={side} align={align}>
      <Popover.Trigger class="docs-popover-trigger">
        Open popover
      </Popover.Trigger>
      <Popover.Positioner class="docs-popover-positioner">
        <Popover.Popup class="docs-popover" aria-label="Placement explorer">
          <Popover.Arrow class="docs-popover__arrow" />
          <Popover.Title class="docs-popover__title">Placement</Popover.Title>
          <Popover.Description class="docs-popover__desc">
            The popover is anchored {side}, aligned {align}.
          </Popover.Description>
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
          <Popover.Close class="docs-popover-close">Done</Popover.Close>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Root>
  );
}
