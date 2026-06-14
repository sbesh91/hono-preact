import { useTypeahead } from '@hono-preact/ui';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

const ITEMS = ['Argon', 'Boron', 'Calcium', 'Carbon', 'Cobalt', 'Neon'];

// useTypeahead returns an onChar(char) callback that accumulates printable
// characters into a query and resets after an idle gap (default 500ms). Type
// while the list is focused to jump to the first matching item. The buffer
// readout shows the accumulation and the idle reset. Styling: .docs-typeahead*.
export function UseTypeaheadDemo() {
  const onChar = useTypeahead();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const handleKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLUListElement>) => {
    if (e.key.length !== 1) return; // ignore non-printable keys (Arrow, Enter, ...)
    const q = onChar(e.key);
    setQuery(q);
    const idx = ITEMS.findIndex((it) =>
      it.toLowerCase().startsWith(q.toLowerCase())
    );
    if (idx >= 0) setActiveIndex(idx);
  };

  return (
    <div class="docs-typeahead">
      <ul
        class="docs-typeahead-list"
        tabIndex={0}
        role="listbox"
        aria-label="Elements"
        aria-activedescendant={`docs-typeahead-${activeIndex}`}
        onKeyDown={handleKeyDown}
      >
        {ITEMS.map((it, i) => (
          <li
            key={it}
            id={`docs-typeahead-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            data-active={i === activeIndex ? '' : undefined}
            class="docs-typeahead-option"
          >
            {it}
          </li>
        ))}
      </ul>
      <p class="docs-typeahead-readout">
        buffer: <code>{query || '(empty)'}</code>
        <span class="docs-typeahead-hint">
          focus the list and type; it resets after 500ms idle
        </span>
      </p>
    </div>
  );
}
