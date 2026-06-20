import { useEffect, useMemo, useState } from 'preact/hooks';
import { Dialog, Combobox } from 'hono-preact-ui';
import { useNavigate } from 'hono-preact';
import { Search } from 'lucide-preact';
import type { DocPage } from '../llms/generate-docs-index.js';
import { searchDocs } from './docs/search.js';

// Cmd+K command palette over the docs heading index. Built on hono-preact-ui's
// Dialog (controlled) + Combobox. The Combobox clicks the highlighted option on
// Enter, so navigation lives in each option's onClick (mouse + keyboard share
// the path).
export function CommandPalette({ pages }: { pages: DocPage[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

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
      >
        <Search size={15} class="shrink-0 opacity-70" />
        <span>Search</span>
        <kbd class="docs-cmdk-kbd">⌘K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Popup class="docs-cmdk" aria-label="Command palette">
          <Combobox.Root onInputChange={setQuery} openOnFocus>
            <Combobox.Input
              class="docs-cb-input docs-cmdk-input"
              placeholder="Search docs…"
              aria-label="Search documentation"
            />
            <Combobox.Status />
            <Combobox.Popup
              class="docs-cb docs-cmdk-list"
              aria-label="Search results"
            >
              {results.map((r) => (
                <Combobox.Option
                  class="docs-cb__option docs-cmdk-option"
                  key={r.href}
                  value={r.href}
                  onClick={() => go(r.href)}
                >
                  <span class="docs-cmdk-option__title">{r.title}</span>
                  {r.section && (
                    <span class="docs-cmdk-option__section">{r.section}</span>
                  )}
                </Combobox.Option>
              ))}
              <Combobox.Empty class="docs-cb__empty">No results</Combobox.Empty>
            </Combobox.Popup>
          </Combobox.Root>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}

export default CommandPalette;
