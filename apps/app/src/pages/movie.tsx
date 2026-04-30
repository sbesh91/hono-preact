// apps/app/src/pages/movie.tsx
import {
  cacheRegistry,
  Form,
  useAction,
  useLoaderData,
  useOptimisticAction,
  useReload,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { loader as movieLoader, serverActions } from './movie.server.js';

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
  const { movie, watched } = useLoaderData(movieLoader);
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
          onClick={() => toggle({ movieId: movie.id, watched: !isWatchedOpt })}
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

export default MovieDetail;
