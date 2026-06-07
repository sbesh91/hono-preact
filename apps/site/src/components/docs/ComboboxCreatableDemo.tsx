import { Combobox, matchSubstring } from '@hono-preact/ui';
import { useState } from 'preact/hooks';

// Creatable: when the query matches no existing option, a `create` option is
// rendered. Selecting it calls `onCreate` (which persists and selects the new
// value) instead of firing `onValueChange`, so the select-from-list invariant
// holds.
export function ComboboxCreatableDemo() {
  const [options, setOptions] = useState(['Apple', 'Banana', 'Cherry']);
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  const filtered = options.filter((o) => matchSubstring(o, query));
  const showCreate =
    query !== '' &&
    !options.some((o) => o.toLowerCase() === query.toLowerCase());
  return (
    <Combobox.Root
      value={value}
      onValueChange={(v) => setValue(Array.isArray(v) ? (v[0] ?? '') : v)}
      onInputChange={setQuery}
      onCreate={(label) => {
        setOptions((prev) => [...prev, label]);
        setValue(label);
      }}
    >
      <div class="docs-cb-field">
        <Combobox.Input
          class="docs-cb-input"
          placeholder="Pick or create…"
          aria-label="Tag"
        />
        <Combobox.Trigger class="docs-cb-trigger" aria-label="Open">
          ▾
        </Combobox.Trigger>
      </div>
      <Combobox.Status />
      <Combobox.Positioner class="docs-cb-positioner">
        <Combobox.Popup class="docs-cb" aria-label="Tag">
          {filtered.map((o) => (
            <Combobox.Option class="docs-cb__option" key={o} value={o}>
              {o}
            </Combobox.Option>
          ))}
          {showCreate && (
            <Combobox.Option
              class="docs-cb__option docs-cb__create"
              value={query}
              create
            >
              Create “{query}”
            </Combobox.Option>
          )}
          <Combobox.Empty class="docs-cb__empty">
            Type to add a tag
          </Combobox.Empty>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
