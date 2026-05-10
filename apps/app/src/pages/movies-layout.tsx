import { createContext } from 'preact';
import { useContext, useMemo, useState } from 'preact/hooks';
import type { LayoutProps } from '@hono-preact/iso';

type MoviesFilter = { query: string; setQuery: (q: string) => void };

const MoviesFilterContext = createContext<MoviesFilter>({
  query: '',
  setQuery: () => {},
});

export const useMoviesFilter = () => useContext(MoviesFilterContext);

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

export default function MoviesLayout({ children }: LayoutProps) {
  // Layout-owned state. preact-iso treats /movies and /movies/:id as the
  // same outer component (shared by defineRoutes' inner-router lowering),
  // so navigating to a detail page and back preserves both the filter and
  // the watched badge count.
  const [query, setQuery] = useState('');
  const [count, setCount] = useState<number | null>(null);

  const filter = useMemo(() => ({ query, setQuery }), [query]);
  const badge = useMemo(() => ({ count, setCount }), [count]);

  return (
    <WatchedBadgeContext.Provider value={badge}>
      <MoviesFilterContext.Provider value={filter}>
        <section class="p-1">
          <header class="flex items-center gap-2">
            <a href="/" class="bg-amber-200">home</a>
            <a href="/watched" class="bg-emerald-200">
              watched ({count ?? '…'})
            </a>
            <input
              type="search"
              placeholder="Filter movies…"
              value={query}
              onInput={(e) =>
                setQuery((e.currentTarget as HTMLInputElement).value)
              }
              class="ml-auto border px-2 py-1"
              aria-label="Filter movies"
            />
          </header>
          <div class="mt-2">{children}</div>
        </section>
      </MoviesFilterContext.Provider>
    </WatchedBadgeContext.Provider>
  );
}
