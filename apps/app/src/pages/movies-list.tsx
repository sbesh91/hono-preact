import {
  cacheRegistry,
  definePage,
  useOptimisticAction,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import type { MovieSummary } from '@/server/data/movies.js';
import { loader, cache, serverActions } from './movies-list.server.js';
import { useMoviesFilter, useWatchedBadge } from './movies-layout.js';

const MoviesList: FunctionComponent = () => {
  const { movies, watchedIds } = loader.useData();
  const { query } = useMoviesFilter();
  const { setCount } = useWatchedBadge();

  const { mutate, value: optimisticWatchedIds } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: watchedIds,
      apply: (current, payload) =>
        payload.watched
          ? [...current, payload.movieId]
          : current.filter((id) => id !== payload.movieId),
      invalidate: 'auto',
      onSuccess: () => cacheRegistry.invalidate('watched'),
    }
  );

  // Push the optimistic count up to the layout's badge. The optimistic value
  // is updated synchronously on click (via useOptimisticAction's queue), so
  // the badge increments immediately and rolls back on action error.
  useEffect(() => {
    setCount(optimisticWatchedIds.length);
  }, [optimisticWatchedIds.length, setCount]);

  const watched = new Set(optimisticWatchedIds);

  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed
    ? movies.results.filter((m: MovieSummary) =>
        m.title.toLowerCase().includes(trimmed)
      )
    : movies.results;

  return (
    <>
      {trimmed && (
        <p>
          showing {filtered.length} of {movies.results.length}
        </p>
      )}
      <ul class="mt-2">
        {filtered.map((m: MovieSummary) => (
          <li key={m.id} class="border-2 m-1 p-1 flex items-center gap-2">
            <a href={`/movies/${m.id}`} class="flex-1">
              {m.title}{' '}
              {watched.has(m.id) && (
                <span class="text-emerald-600">✓ watched</span>
              )}
            </a>
            <button
              type="button"
              class="bg-blue-500 text-white px-2 py-1 text-sm"
              onClick={() =>
                mutate({ movieId: m.id, watched: !watched.has(m.id) })
              }
            >
              {watched.has(m.id) ? 'Unwatch' : 'Mark watched'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};
MoviesList.displayName = 'MoviesList';

export default definePage(MoviesList, { loader, cache });
