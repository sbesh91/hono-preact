import { useState } from 'preact/hooks';
import { UsePositionExample } from './UsePositionExample.js';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const ALIGNS = ['start', 'center', 'end'] as const;

// Placement explorer harness around the UsePositionExample core. The fieldset
// controls exist only here (the docs Code tab shows UsePositionExample, the real
// usage). Styling: .docs-useposition* in root.css.
export function UsePositionDemo() {
  const [side, setSide] = useState<(typeof SIDES)[number]>('bottom');
  const [align, setAlign] = useState<(typeof ALIGNS)[number]>('center');
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
      <UsePositionExample side={side} align={align} />
    </div>
  );
}
