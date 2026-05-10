import { createContext } from 'preact';
import { useContext, useState } from 'preact/hooks';
import type { LayoutProps } from '@hono-preact/iso';

type MoviesFilter = { query: string; setQuery: (q: string) => void };

const MoviesFilterContext = createContext<MoviesFilter>({
  query: '',
  setQuery: () => {},
});

export const useMoviesFilter = () => useContext(MoviesFilterContext);

export default function MoviesLayout({ children }: LayoutProps) {
  // Layout-owned state. preact-iso treats /movies and /movies/:id as the
  // same outer component (shared by defineRoutes' inner-router lowering),
  // so navigating to a detail page and back preserves this filter.
  const [query, setQuery] = useState('');

  return (
    <MoviesFilterContext.Provider value={{ query, setQuery }}>
      <section class="p-1">
        <header class="flex items-center gap-2">
          <a href="/" class="bg-amber-200">home</a>
          <a href="/watched" class="bg-emerald-200">watched</a>
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
  );
}
