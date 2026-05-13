import { definePage, useOptimisticAction } from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import type { MovieSummary } from '@/server/data/movies.js';
import { serverLoaders, serverActions, type SearchResults } from './movies-list.server.js';
import { serverLoaders as watchedLoaders } from './watched.server.js';
import { useWatchedBadge } from './movies-layout.js';

const moviesLoader = serverLoaders.default;
const watchedLoader = watchedLoaders.default;

type ToggleFn = (payload: { movieId: number; watched: boolean }) => void;

const Row: FunctionComponent<{
  m: MovieSummary;
  watched: Set<number>;
  onToggle: ToggleFn;
}> = ({ m, watched, onToggle }) => (
  <li class="border-2 m-1 p-1 flex items-center gap-2">
    <a href={`/movies/${m.id}`} class="flex-1">
      {m.title}{' '}
      {watched.has(m.id) && <span class="text-emerald-600">✓ watched</span>}
    </a>
    <button
      type="button"
      class="bg-blue-500 text-white px-2 py-1 text-sm"
      onClick={() => onToggle({ movieId: m.id, watched: !watched.has(m.id) })}
    >
      {watched.has(m.id) ? 'Unwatch' : 'Mark watched'}
    </button>
  </li>
);

const Bucket: FunctionComponent<{
  title: string;
  movies: MovieSummary[];
  watched: Set<number>;
  onToggle: ToggleFn;
}> = ({ title, movies, watched, onToggle }) => {
  if (movies.length === 0) return null;
  return (
    <section class="mt-3">
      <h2 class="font-semibold">{title}</h2>
      <ul>
        {movies.map((m) => (
          <Row key={m.id} m={m} watched={watched} onToggle={onToggle} />
        ))}
      </ul>
    </section>
  );
};

const MoviesList: FunctionComponent = () => {
  const data = moviesLoader.useData() as SearchResults;
  const error = moviesLoader.useError();
  const { setCount } = useWatchedBadge();

  const { mutate, value: optimisticWatchedIds } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: data.watchedIds,
      apply: (current, payload) =>
        payload.watched
          ? [...current, payload.movieId]
          : current.filter((id) => id !== payload.movieId),
      invalidate: [moviesLoader, watchedLoader],
    }
  );

  useEffect(() => {
    setCount(optimisticWatchedIds.length);
  }, [optimisticWatchedIds.length, setCount]);

  const watched = new Set(optimisticWatchedIds);

  return (
    <>
      {error && (
        <p class="text-red-700 bg-red-100 p-2 my-2">
          Search failed: {error.message}
        </p>
      )}
      {data.mode === 'list' ? (
        <ul class="mt-2">
          {data.movies.results.map((m) => (
            <Row key={m.id} m={m} watched={watched} onToggle={mutate} />
          ))}
        </ul>
      ) : (
        <>
          <p class="text-sm text-gray-600 mt-2">Results for "{data.query}"</p>
          <Bucket title="Exact matches"   movies={data.buckets.exact}          watched={watched} onToggle={mutate} />
          <Bucket title="Title contains"  movies={data.buckets.titleSubstring} watched={watched} onToggle={mutate} />
          <Bucket title="Overview mentions" movies={data.buckets.overview}     watched={watched} onToggle={mutate} />
          <Bucket title="Genre"           movies={data.buckets.genre}          watched={watched} onToggle={mutate} />
        </>
      )}
    </>
  );
};
MoviesList.displayName = 'MoviesList';

const MoviesListPage = moviesLoader.View(() => <MoviesList />);

export default definePage(MoviesListPage, {});
