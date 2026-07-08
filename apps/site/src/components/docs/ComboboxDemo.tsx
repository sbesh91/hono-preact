import { Combobox, matchSubstring } from 'hono-preact-ui';
import { useState } from 'preact/hooks';

const FRUITS = ['Apple', 'Banana', 'Cherry', 'Orange', 'Lemon', 'Mango'];

// A single-select combobox in its minimal form: just an Input. It opens on
// focus (the default), anchors the popup to itself, and the consumer filters
// FRUITS by the typed query. Styling is in docs.css (.docs-cb*).
export function ComboboxDemo() {
  const [query, setQuery] = useState('');
  const filtered = FRUITS.filter((f) => matchSubstring(f, query));
  return (
    <Combobox.Root onInputChange={setQuery}>
      <Combobox.Input
        class="docs-cb-input"
        placeholder="Search fruit…"
        aria-label="Fruit"
      />
      <Combobox.Status />
      <Combobox.Positioner class="docs-cb-positioner">
        <Combobox.Popup class="docs-cb" aria-label="Fruit">
          {filtered.map((f) => (
            <Combobox.Option class="docs-cb__option" key={f} value={f}>
              {f}
            </Combobox.Option>
          ))}
          <Combobox.Empty class="docs-cb__empty">No results</Combobox.Empty>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
