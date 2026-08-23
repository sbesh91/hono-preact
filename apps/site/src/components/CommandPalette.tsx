import { useEffect, useMemo, useState } from 'preact/hooks';
import { Dialog, Listbox } from 'hono-preact-ui';
import { useNavigate } from 'hono-preact';
import { Search } from 'lucide-preact';
import type { DocPage } from '../llms/docs-index.js';
import { searchDocs } from './docs/search.js';

// Cmd+K command palette over the docs heading index. Built on hono-preact-ui's
// Dialog plus the Listbox part set: the parts own the combobox/listbox ARIA
// wiring, activedescendant navigation, highlight-first-result, commit, and
// announcements, while the palette owns the query, the search, and navigation.
// A modal palette wants a plain static results list, not the Combobox's
// anchored-dropdown machinery: clicks are plain commits (no dismiss layer to
// swallow them), Escape closes the dialog, and the list does not float.
export function CommandPalette({ pages }: { pages: DocPage[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

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

  function go(href: string) {
    setOpen(false);
    setQuery('');
    navigate(href);
  }

  return (
    <>
      <button
        type="button"
        class="docs-cmdk-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search docs"
      >
        <Search size={15} class="shrink-0 opacity-70" />
        <span class="hidden md:inline">Search</span>
        <kbd class="docs-cmdk-kbd hidden md:inline">⌘K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Popup class="docs-cmdk" aria-label="Command palette">
          {/* enabled={open}: while closed, the (still-mounted) list stops
              navigating and Listbox.Status goes blank, so OPENING is a real
              text change ("" -> "N results available") screen readers announce. */}
          <Listbox.Root enabled={open} onCommit={go}>
            <Listbox.Input
              class="docs-cb-input docs-cmdk-input"
              placeholder="Search docs…"
              aria-label="Search documentation"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autofocus
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
            />
            <Listbox.Status />
            <Listbox.List
              aria-label="Search results"
              class="docs-cb docs-cmdk-list"
            >
              {results.map((r) => (
                <Listbox.Option
                  key={r.href}
                  value={r.href}
                  class="docs-cb__option docs-cmdk-option"
                >
                  <span class="docs-cmdk-option__title">{r.title}</span>
                  {r.section && (
                    <span class="docs-cmdk-option__section">{r.section}</span>
                  )}
                </Listbox.Option>
              ))}
              <Listbox.Empty class="docs-cb__empty">No results</Listbox.Empty>
            </Listbox.List>
          </Listbox.Root>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}

export default CommandPalette;
