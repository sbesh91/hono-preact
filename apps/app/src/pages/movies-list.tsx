import {
  cacheRegistry,
  definePage,
  useLoaderData,
  useOptimisticAction,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import type { MovieSummary } from '@/server/data/movies.js';
import { loader, cache, serverActions } from './movies-list.server.js';

const MoviesList: FunctionComponent = () => {
  const { movies, watchedIds } = useLoaderData<typeof loader>();

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

  const watched = new Set(optimisticWatchedIds);

  return (
    <>
      <p>watched: {optimisticWatchedIds.length}</p>
      <ul class="mt-2">
        {movies.results.map((m: MovieSummary) => (
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
