// apps/app/src/pages/movie.tsx
import {
  cacheRegistry,
  Form,
  getLoaderData,
  type LoaderData,
  useAction,
  useReload,
  type WrapperProps,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import type { Movie } from '@/server/data/movie.js';
import type { WatchedRecord } from '@/server/watched.js';
import serverLoader, { serverActions } from './movie.server.js';

type Data = { movie: Movie | null; watched: WatchedRecord | null };

const MovieDetail: FunctionComponent<LoaderData<Data>> = (props) => {
  const { movie, watched } = props.loaderData;
  if (!movie) return <p>Movie not found.</p>;

  const isWatched = !!watched && watched.watchedAt > 0;
  const movieIdStr = String(movie.id);

  const reload = useReload();

  const { mutate: toggle, pending: togglePending } = useAction(
    serverActions.toggleWatched,
    {
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
        {isWatched && (
          <p class="text-emerald-700">
            ✓ watched on {new Date(watched!.watchedAt).toLocaleDateString()}
          </p>
        )}
      </header>

      <div class="flex gap-2">
        <button
          type="button"
          class="bg-blue-500 text-white px-3 py-1"
          disabled={togglePending}
          onClick={() => toggle({ movieId: movie.id, watched: !isWatched })}
        >
          {isWatched ? 'Unwatch' : 'Mark watched'}
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
        <Form
          action={serverActions.setNotes}
          invalidate="auto"
          onSuccess={() => cacheRegistry.invalidate('watched')}
          class="flex flex-col gap-2 mt-1"
        >
          <input type="hidden" name="movieId" value={movieIdStr} />
          <textarea
            key={movie.id}
            name="notes"
            class="border p-1 w-full"
            rows={3}
            defaultValue={watched?.notes ?? ''}
          />
          <button
            type="submit"
            class="bg-blue-500 text-white px-3 py-1 self-start"
          >
            Save notes
          </button>
        </Form>
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
        <Form
          action={serverActions.setPhoto}
          invalidate="auto"
          onSuccess={() => cacheRegistry.invalidate('watched')}
          class="flex flex-col gap-2 mt-1"
        >
          <input type="hidden" name="movieId" value={movieIdStr} />
          <input type="file" name="photo" accept="image/*" />
          <button
            type="submit"
            class="bg-blue-500 text-white px-3 py-1 self-start"
          >
            Upload photo
          </button>
        </Form>
      </section>
    </section>
  );
};
MovieDetail.displayName = 'MovieDetail';

function MovieWrapper(props: WrapperProps) {
  return <article {...props} />;
}

export default getLoaderData(MovieDetail, {
  serverLoader,
  Wrapper: MovieWrapper,
});
