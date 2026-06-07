import { Combobox, matchSubstring } from '@hono-preact/ui';
import { useState } from 'preact/hooks';

const FRUITS = ['Apple', 'Banana', 'Cherry', 'Orange', 'Lemon', 'Mango'];

// A single-select combobox: the consumer filters FRUITS by the typed query and
// renders the matches, while the component owns navigation, ARIA wiring, and
// the commit. Styling is in root.css (.docs-cb*), using the site theme tokens
// so it tracks light/dark.
export function ComboboxDemo() {
  const [query, setQuery] = useState('');
  const filtered = FRUITS.filter((f) => matchSubstring(f, query));
  return (
    <Combobox.Root onInputChange={setQuery}>
      <div class="docs-cb-field">
        <Combobox.Input
          class="docs-cb-input"
          placeholder="Search fruit…"
          aria-label="Fruit"
        />
        <Combobox.Trigger class="docs-cb-trigger" aria-label="Open">
          ▾
        </Combobox.Trigger>
      </div>
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
