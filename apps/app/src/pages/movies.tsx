// apps/app/src/pages/movies.tsx
import { cacheRegistry, useLoaderData, useOptimisticAction } from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { lazy, Route, Router } from 'preact-iso';
import type { MovieSummary, MoviesData } from '@/server/data/movies.js';
import { loader as moviesLoader, serverActions } from './movies.server.js';
import Noop from './noop.js';

const Movie = lazy(() => import('./movie.js'));

const Movies: FunctionComponent = () => {
  const { movies, watchedIds } = useLoaderData(moviesLoader);

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
    <section class="p-1">
      <a href="/" class="bg-amber-200">
        home
      </a>{' '}
      <a href="/watched" class="bg-emerald-200">
        watched ({optimisticWatchedIds.length})
      </a>
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
      <Router>
        <Route path="/:id" component={Movie} />
        <Noop />
      </Router>
    </section>
  );
};
Movies.displayName = 'Movies';

export default Movies;
