import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { Dialog, useListNavigation } from 'hono-preact-ui';
import { useNavigate } from 'hono-preact';
import { Search } from 'lucide-preact';
import type { DocPage } from '../llms/docs-index.js';
import { searchDocs } from './docs/search.js';

// Cmd+K command palette over the docs heading index. Built on hono-preact-ui's
// Dialog plus useListNavigation (the same keyboard-nav primitive the Combobox
// uses internally). A modal palette wants a plain static results list, not the
// Combobox's anchored-dropdown machinery: clicks are plain onClick (no dismiss
// layer to swallow them), Escape closes the dialog, and the list does not float.
export function CommandPalette({ pages }: { pages: DocPage[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  // Cmd/Ctrl+K toggles the palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => searchDocs(pages, query), [pages, query]);

  // Highlight the first result whenever the result set changes (typing, open).
  useEffect(() => {
    setActiveId(results.length > 0 ? optionId(0) : null);
    // optionId is derived from the stable baseId; results identity is the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const nav = useListNavigation({
    enabled: open,
    containerRef: listRef,
    itemSelector: '[role="option"]',
    activeId,
    setActiveId,
    mode: 'activedescendant',
  });

  function go(href: string) {
    setOpen(false);
    setQuery('');
    navigate(href);
  }

  function onInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const idx = results.findIndex((_, i) => optionId(i) === activeId);
      const chosen = results[idx] ?? results[0];
      if (chosen) go(chosen.href);
      return;
    }
    nav.onKeyDown(e);
  }

  return (
    <>
      <button
        type="button"
        class="docs-cmdk-trigger"
        onClick={() => setOpen(true)}
      >
        <Search size={15} class="shrink-0 opacity-70" />
        <span>Search</span>
        <kbd class="docs-cmdk-kbd">⌘K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Popup class="docs-cmdk" aria-label="Command palette">
          <input
            type="text"
            class="docs-cb-input docs-cmdk-input"
            placeholder="Search docs…"
            aria-label="Search documentation"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeId ?? undefined}
            autocomplete="off"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autofocus
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={onInputKeyDown}
          />
          <div
            role="status"
            aria-live="polite"
            class="sr-only"
          >{`${results.length} result${results.length === 1 ? '' : 's'}`}</div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Search results"
            class="docs-cb docs-cmdk-list"
          >
            {results.map((r, i) => (
              <div
                key={r.href}
                id={optionId(i)}
                role="option"
                aria-selected={activeId === optionId(i)}
                data-highlighted={activeId === optionId(i) ? '' : undefined}
                class="docs-cb__option docs-cmdk-option"
                onPointerEnter={() => setActiveId(optionId(i))}
                onClick={() => go(r.href)}
              >
                <span class="docs-cmdk-option__title">{r.title}</span>
                {r.section && (
                  <span class="docs-cmdk-option__section">{r.section}</span>
                )}
              </div>
            ))}
            {results.length === 0 && (
              <div class="docs-cb__empty">No results</div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}

export default CommandPalette;
