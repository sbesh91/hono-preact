import { Combobox, matchSubstring } from '@hono-preact/ui';
import { useState } from 'preact/hooks';

const CITIES = [
  'Amsterdam',
  'Barcelona',
  'Copenhagen',
  'Dublin',
  'Edinburgh',
  'Florence',
  'Geneva',
  'Helsinki',
];

// Inline autocomplete (autocomplete="both"): the input displays the first
// matching option's label as a selected suffix after the typed text. Enter or
// Tab accepts it; Backspace or ArrowLeft dismisses it and keeps the query.
// Minimal form: just an Input.
export function ComboboxInlineDemo() {
  const [query, setQuery] = useState('');
  const filtered = CITIES.filter((c) => matchSubstring(c, query));
  return (
    <Combobox.Root autocomplete="both" onInputChange={setQuery}>
      <Combobox.Input
        class="docs-cb-input"
        placeholder="Type a city…"
        aria-label="City"
      />
      <Combobox.Status />
      <Combobox.Positioner class="docs-cb-positioner">
        <Combobox.Popup class="docs-cb" aria-label="City">
          {filtered.map((c) => (
            <Combobox.Option class="docs-cb__option" key={c} value={c}>
              {c}
            </Combobox.Option>
          ))}
          <Combobox.Empty class="docs-cb__empty">No results</Combobox.Empty>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
