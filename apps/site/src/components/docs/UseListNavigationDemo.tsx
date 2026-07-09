import { useListNavigation } from 'hono-preact-ui';
import { useId, useRef, useState } from 'preact/hooks';

const OPTIONS = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Violet'];

// An activedescendant listbox: the trigger keeps DOM focus while ArrowUp/Down,
// Home/End, and typeahead move aria-activedescendant over the options (wrapping
// at the ends, scrolling into view). Styling: .docs-listnav* in docs.css.
export function UseListNavigationDemo() {
  const listRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const nav = useListNavigation({
    enabled: open,
    containerRef: listRef,
    itemSelector: '[role="option"]',
    activeId,
    setActiveId,
    mode: 'activedescendant',
  });

  return (
    <div class="docs-listnav">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? (activeId ?? undefined) : undefined}
        class="docs-listnav-trigger"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (open) nav.onKeyDown(e);
        }}
      >
        {open ? 'Arrow / Home / End / type a letter' : 'Open list'}
      </button>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        class="docs-listnav-list"
        hidden={!open}
      >
        {OPTIONS.map((opt) => {
          const id = `${baseId}-${opt}`;
          return (
            <div
              key={opt}
              id={id}
              role="option"
              aria-selected={activeId === id}
              data-active={activeId === id ? '' : undefined}
              class="docs-listnav-option"
            >
              {opt}
            </div>
          );
        })}
      </div>
    </div>
  );
}
