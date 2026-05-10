// apps/app/src/pages/movie.tsx
import {
  cacheRegistry,
  definePage,
  Form,
  useAction,
  useLoaderData,
  useOptimisticAction,
  useReload,
  type WrapperProps,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import { loader, serverActions } from './movie.server.js';
import { useWatchedBadge } from './movies-layout.js';

function MovieWrapper(props: WrapperProps) {
  return <article {...props} />;
}

const NotesForm: FunctionComponent<{
  movieIdStr: string;
  defaultNotes: string;
  movieKey: number;
}> = ({ movieIdStr, defaultNotes, movieKey }) => {
  const { mutate, pending } = useAction(serverActions.setNotes, {
    invalidate: 'auto',
    onSuccess: () => cacheRegistry.invalidate('watched'),
  });
  return (
    <Form mutate={mutate} pending={pending} class="flex flex-col gap-2 mt-1">
      <input type="hidden" name="movieId" value={movieIdStr} />
      <textarea
        key={movieKey}
        name="notes"
        class="border p-1 w-full"
        rows={3}
        defaultValue={defaultNotes}
      />
      <button
        type="submit"
        class="bg-blue-500 text-white px-3 py-1 self-start"
      >
        Save notes
      </button>
    </Form>
  );
};

const PhotoForm: FunctionComponent<{ movieIdStr: string }> = ({ movieIdStr }) => {
  const { mutate, pending } = useAction(serverActions.setPhoto, {
    invalidate: 'auto',
    onSuccess: () => cacheRegistry.invalidate('watched'),
  });
  return (
    <Form mutate={mutate} pending={pending} class="flex flex-col gap-2 mt-1">
      <input type="hidden" name="movieId" value={movieIdStr} />
      <input type="file" name="photo" accept="image/*" />
      <button
        type="submit"
        class="bg-blue-500 text-white px-3 py-1 self-start"
      >
        Upload photo
      </button>
    </Form>
  );
};

const MovieDetail: FunctionComponent = () => {
  const { movie, watched, watchedCount } = useLoaderData<typeof loader>();
  const { setCount } = useWatchedBadge();

  // Seed/refresh the layout badge from the loader's authoritative count.
  // Runs on first detail-page mount (covers direct visits to /movies/:id)
  // and again whenever the loader reloads after a successful mutation.
  useEffect(() => {
    setCount(watchedCount);
  }, [watchedCount, setCount]);

  if (!movie) return <p>Movie not found.</p>;

  const isWatched = !!watched && watched.watchedAt > 0;
  const movieIdStr = String(movie.id);

  const reload = useReload();

  const { mutate: toggle, value: isWatchedOpt } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: isWatched,
      apply: (_current, payload) => payload.watched,
      invalidate: 'auto',
      onSuccess: () => {
        cacheRegistry.invalidate('movies-list');
        cacheRegistry.invalidate('watched');
      },
    }
  );

  const handleToggle = () => {
    const next = !isWatchedOpt;
    // Optimistic delta on the layout's badge so the count increments the
    // instant the user clicks. The detail's own loader reloads on action
    // success and the seeding effect above converges back to truth.
    setCount((c) => (c == null ? c : next ? c + 1 : c - 1));
    toggle({ movieId: movie.id, watched: next });
  };

  return (
    <section class="p-1 space-y-4">
      <a href="/movies" class="bg-red-200">
        movies
      </a>

      <header>
        <h1 class="text-xl font-semibold">{movie.title}</h1>
        {isWatchedOpt && (
          <p class="text-emerald-700">
            ✓ watched
            {watched
              ? ` on ${new Date(watched.watchedAt).toLocaleDateString()}`
              : ''}
          </p>
        )}
      </header>

      <div class="flex gap-2">
        <button
          type="button"
          class="bg-blue-500 text-white px-3 py-1"
          onClick={handleToggle}
        >
          {isWatchedOpt ? 'Unwatch' : 'Mark watched'}
        </button>
        <button
          type="button"
          class="bg-gray-300 px-3 py-1"
          onClick={() => reload.reload()}
        >
          Refresh
        </button>
      </div>

      <section>
        <h2 class="font-semibold">Notes</h2>
        <NotesForm
          movieIdStr={movieIdStr}
          defaultNotes={watched?.notes ?? ''}
          movieKey={movie.id}
        />
      </section>

      <section>
        <h2 class="font-semibold">Memory photo</h2>
        {watched?.photo && (
          <img
            src={`/api/watched/${movie.id}/photo`}
            alt="memory"
            class="max-w-xs my-2"
          />
        )}
        <PhotoForm movieIdStr={movieIdStr} />
      </section>
    </section>
  );
};
MovieDetail.displayName = 'MovieDetail';

export default definePage(MovieDetail, { loader, Wrapper: MovieWrapper });
