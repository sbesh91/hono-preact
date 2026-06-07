import { Combobox, matchSubstring } from '@hono-preact/ui';
import { useState } from 'preact/hooks';

const LANGS = ['TypeScript', 'JavaScript', 'Rust', 'Go', 'Python', 'Ruby'];

// Multiple selection: picking an option toggles it and keeps the popup open.
// `Combobox.Value` renders the selected chips through a render function;
// Backspace on an empty input removes the last token.
export function ComboboxMultiDemo() {
  const [query, setQuery] = useState('');
  const filtered = LANGS.filter((l) => matchSubstring(l, query));
  return (
    <Combobox.Root multiple onInputChange={setQuery}>
      <div class="docs-cb-field docs-cb-field--multi">
        <Combobox.Value>
          {({ selectedItems, remove }) =>
            selectedItems.map((it) => (
              <span class="docs-cb-chip" key={String(it.value)}>
                {it.label}
                <button
                  type="button"
                  class="docs-cb-chip__remove"
                  onClick={() => remove(it.value)}
                  aria-label={`Remove ${it.label}`}
                >
                  ×
                </button>
              </span>
            ))
          }
        </Combobox.Value>
        <Combobox.Input
          class="docs-cb-input docs-cb-input--multi"
          placeholder="Add language…"
          aria-label="Languages"
        />
      </div>
      <Combobox.Status />
      <Combobox.Positioner class="docs-cb-positioner">
        <Combobox.Popup class="docs-cb" aria-label="Languages">
          {filtered.map((l) => (
            <Combobox.Option class="docs-cb__option" key={l} value={l}>
              {l}
            </Combobox.Option>
          ))}
          <Combobox.Empty class="docs-cb__empty">No results</Combobox.Empty>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
