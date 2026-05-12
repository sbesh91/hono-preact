// apps/app/src/pages/movie.tsx
import {
  definePage,
  Form,
  useAction,
  useOptimisticAction,
  useReload,
  type WrapperProps,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';
import { loader, serverActions, type DetailStream } from './movie.server.js';
import { loader as moviesListLoader } from './movies-list.server.js';
import { loader as watchedLoader } from './watched.server.js';
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
    invalidate: [loader, watchedLoader],
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
      <button type="submit" class="bg-blue-500 text-white px-3 py-1 self-start">
        Save notes
      </button>
    </Form>
  );
};

const PhotoForm: FunctionComponent<{ movieIdStr: string }> = ({ movieIdStr }) => {
  const { mutate, pending } = useAction(serverActions.setPhoto, {
    invalidate: [loader, watchedLoader],
  });
  return (
    <Form mutate={mutate} pending={pending} class="flex flex-col gap-2 mt-1">
      <input type="hidden" name="movieId" value={movieIdStr} />
      <input type="file" name="photo" accept="image/*" />
      <button type="submit" class="bg-blue-500 text-white px-3 py-1 self-start">
        Upload photo
      </button>
    </Form>
  );
};

const SummarySection: FunctionComponent<{ summary: string }> = ({ summary }) => {
  if (!summary) {
    return (
      <div class="space-y-2 animate-pulse">
        <div class="h-3 bg-gray-200 w-11/12" />
        <div class="h-3 bg-gray-200 w-10/12" />
        <div class="h-3 bg-gray-200 w-9/12" />
      </div>
    );
  }
  return <p class="leading-relaxed">{summary}</p>;
};

const CastSection: FunctionComponent<{ cast: DetailStream['cast'] }> = ({ cast }) => {
  if (cast.length === 0) {
    return (
      <ul class="space-y-1 animate-pulse">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} class="h-4 bg-gray-200 w-1/3" />
        ))}
      </ul>
    );
  }
  return (
    <ul class="space-y-1">
      {cast.map((c) => (
        <li key={c.name}>
          <span class="font-medium">{c.name}</span> · {c.role}
        </li>
      ))}
    </ul>
  );
};

const SimilarSection: FunctionComponent<{ similar: DetailStream['similar'] }> = ({ similar }) => {
  if (similar.length === 0) {
    return (
      <ul class="grid grid-cols-2 md:grid-cols-4 gap-2 animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} class="h-20 bg-gray-200" />
        ))}
      </ul>
    );
  }
  return (
    <ul class="grid grid-cols-2 md:grid-cols-4 gap-2">
      {similar.map((m) => (
        <li key={m.id} class="border p-2">
          <a href={`/movies/${m.id}`} class="font-medium">{m.title}</a>
        </li>
      ))}
    </ul>
  );
};

const BoxOfficeSection: FunctionComponent<{
  boxOffice: DetailStream['boxOffice'];
  error: Error | null;
}> = ({ boxOffice, error }) => {
  if (error) {
    return (
      <p class="text-red-700 bg-red-100 p-2">Box office unavailable: {error.message}</p>
    );
  }
  if (!boxOffice) {
    return (
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} class="h-12 bg-gray-200" />
        ))}
      </div>
    );
  }
  const fmt = (n: number) => `$${Math.round(n / 1_000_000)}M`;
  return (
    <dl class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div><dt class="text-xs text-gray-600">Budget</dt><dd>{fmt(boxOffice.budget)}</dd></div>
      <div><dt class="text-xs text-gray-600">Revenue</dt><dd>{fmt(boxOffice.revenue)}</dd></div>
      <div><dt class="text-xs text-gray-600">Opening weekend</dt><dd>{fmt(boxOffice.openingWeekend)}</dd></div>
      <div><dt class="text-xs text-gray-600">Screens</dt><dd>{boxOffice.screens.toLocaleString()}</dd></div>
    </dl>
  );
};

const MovieDetail: FunctionComponent = () => {
  const data = loader.useData();
  const error = loader.useError();
  const { setCount } = useWatchedBadge();

  useEffect(() => { setCount(data.watchedCount); }, [data.watchedCount, setCount]);

  if (!data.movie) return <p>Movie not found.</p>;

  const isWatched = !!data.watched && data.watched.watchedAt > 0;
  const movieIdStr = String(data.movie.id);

  const reload = useReload();
  const { mutate: toggle, value: isWatchedOpt } = useOptimisticAction(
    serverActions.toggleWatched,
    {
      base: isWatched,
      apply: (_current, payload) => payload.watched,
      invalidate: [loader, moviesListLoader, watchedLoader],
    }
  );

  const handleToggle = () => {
    const next = !isWatchedOpt;
    setCount((c) => (c == null ? c : next ? c + 1 : c - 1));
    toggle({ movieId: data.movie!.id, watched: next });
  };

  return (
    <section class="p-1 space-y-4">
      <a href="/movies" class="bg-red-200">movies</a>

      <header>
        <h1 class="text-xl font-semibold">{data.movie.title}</h1>
        {isWatchedOpt && (
          <p class="text-emerald-700">
            ✓ watched
            {data.watched ? ` on ${new Date(data.watched.watchedAt).toLocaleDateString()}` : ''}
          </p>
        )}
      </header>

      <div class="flex gap-2">
        <button type="button" class="bg-blue-500 text-white px-3 py-1" onClick={handleToggle}>
          {isWatchedOpt ? 'Unwatch' : 'Mark watched'}
        </button>
        <button type="button" class="bg-gray-300 px-3 py-1" onClick={() => reload.reload()}>
          Refresh
        </button>
      </div>

      <section>
        <h2 class="font-semibold">Summary</h2>
        <SummarySection summary={data.summary} />
      </section>

      <section>
        <h2 class="font-semibold">Cast</h2>
        <CastSection cast={data.cast} />
      </section>

      <section>
        <h2 class="font-semibold">Similar movies</h2>
        <SimilarSection similar={data.similar} />
      </section>

      <section>
        <h2 class="font-semibold">Box office</h2>
        <BoxOfficeSection boxOffice={data.boxOffice} error={error} />
      </section>

      <section>
        <h2 class="font-semibold">Notes</h2>
        <NotesForm
          movieIdStr={movieIdStr}
          defaultNotes={data.watched?.notes ?? ''}
          movieKey={data.movie.id}
        />
      </section>

      <section>
        <h2 class="font-semibold">Memory photo</h2>
        {data.watched?.photo && (
          <img src={`/api/watched/${data.movie.id}/photo`} alt="memory" class="max-w-xs my-2" />
        )}
        <PhotoForm movieIdStr={movieIdStr} />
      </section>
    </section>
  );
};
MovieDetail.displayName = 'MovieDetail';

export default definePage(MovieDetail, { loader, Wrapper: MovieWrapper });
