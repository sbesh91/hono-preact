import { Listbox } from 'hono-preact-ui';
import { useMemo, useState } from 'preact/hooks';

const COMMANDS = [
  'Open file…',
  'Go to symbol…',
  'Toggle theme',
  'Restart server',
  'Copy deep link',
];

// A minimal command list: the consumer owns the query and the result set (a
// palette usually searches an index); the parts own the combobox/listbox ARIA
// wiring, the highlight, commit, and announcements. Styling is in docs.css
// (.docs-cb*). A real palette wraps this in a Dialog; see the Command palette
// section below.
export function ListboxDemo() {
  const [query, setQuery] = useState('');
  const [ran, setRan] = useState<string | null>(null);
  const results = useMemo(
    () => COMMANDS.filter((c) => c.toLowerCase().includes(query.toLowerCase())),
    [query]
  );
  return (
    <div>
      <Listbox.Root onCommit={setRan}>
        <Listbox.Input
          class="docs-cb-input"
          placeholder="Type a command…"
          aria-label="Command"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <Listbox.Status />
        <Listbox.List aria-label="Commands" class="docs-cb docs-listbox">
          {results.map((c) => (
            <Listbox.Option class="docs-cb__option" key={c} value={c}>
              {c}
            </Listbox.Option>
          ))}
          <Listbox.Empty class="docs-cb__empty">No commands</Listbox.Empty>
        </Listbox.List>
      </Listbox.Root>
      <p class="docs-listbox-ran" aria-live="polite">
        {ran ? `Ran: ${ran}` : 'Pick a command to run it.'}
      </p>
    </div>
  );
}
