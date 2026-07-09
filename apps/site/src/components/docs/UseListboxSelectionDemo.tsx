import { useState } from 'preact/hooks';
import { UseListboxSelectionExample } from './UseListboxSelectionExample.js';

// Explorer harness around the UseListboxSelectionExample core. The multiple
// checkbox exists only here (the docs Code tab shows UseListboxSelectionExample,
// the real usage). Resets the selection when the mode switches so stale values
// from one mode don't carry over. Styling: .docs-listboxsel* in docs.css.
export function UseListboxSelectionDemo() {
  const [multiple, setMultiple] = useState(false);
  return (
    <div class="docs-listboxsel">
      <label class="docs-listboxsel-mode">
        <input
          type="checkbox"
          checked={multiple}
          onChange={(e) => setMultiple(e.currentTarget.checked)}
        />
        multiple
      </label>
      <UseListboxSelectionExample key={String(multiple)} multiple={multiple} />
    </div>
  );
}
