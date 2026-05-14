import { createContext } from 'preact';
import type { FunctionComponent } from 'preact';
import {
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'preact/hooks';
import type { LayoutProps } from 'hono-preact';
import { useLocation } from 'hono-preact';

type WatchedBadge = {
  count: number | null;
  setCount: (
    value: number | null | ((prev: number | null) => number | null)
  ) => void;
};

const WatchedBadgeContext = createContext<WatchedBadge>({
  count: null,
  setCount: () => {},
});

export const useWatchedBadge = () => useContext(WatchedBadgeContext);

function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const SearchInput: FunctionComponent = () => {
  const location = useLocation();
  const currentQ = ((location.searchParams as Record<string, string>)?.q ?? '');
  const [draft, setDraft] = useState(currentQ);
  const debounced = useDebounce(draft, 250);

  useEffect(() => { setDraft(currentQ); }, [currentQ]);

  useEffect(() => {
    if (debounced === currentQ) return;
    const next = debounced
      ? `/movies?q=${encodeURIComponent(debounced)}`
      : '/movies';
    location.route(next, true);
  }, [debounced, currentQ, location]);

  return (
    <input
      type="search"
      placeholder="Search movies…"
      value={draft}
      onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
      class="ml-auto border px-2 py-1"
      aria-label="Search movies"
    />
  );
};

export default function MoviesLayout({ children }: LayoutProps) {
  const [count, setCount] = useState<number | null>(null);
  const badge = useMemo(() => ({ count, setCount }), [count]);

  return (
    <WatchedBadgeContext.Provider value={badge}>
      <section class="p-1">
        <header class="flex items-center gap-2">
          <a href="/" class="bg-amber-200">home</a>
          <a href="/watched" class="bg-emerald-200">
            watched ({count ?? '…'})
          </a>
          <SearchInput />
        </header>
        <div class="mt-2">{children}</div>
      </section>
    </WatchedBadgeContext.Provider>
  );
}
