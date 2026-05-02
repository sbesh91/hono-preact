// apps/app/src/pages/watched.tsx
import {
  cacheRegistry,
  definePage,
  useAction,
  useLoaderData,
  useReload,
} from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { cache, loader, serverActions } from './watched.server.js';

const WatchedPage: FunctionComponent = () => {
  const { entries } = useLoaderData<typeof loader>();
  const [progress, setProgress] = useState<{ count: number; total: number } | null>(null);

  const reload = useReload();

  const { mutate: remove, pending: removing } = useAction(serverActions.removeWatched, {
    invalidate: 'auto',
    onSuccess: () => cacheRegistry.invalidate('movies-list'),
  });

  const { mutate: bulkImport, pending: importing } = useAction(
    serverActions.bulkImportWatched,
    {
      onChunk: (chunk) => {
        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;
          try {
            setProgress(JSON.parse(line) as { count: number; total: number });
          } catch {
            // ignore malformed line
          }
        }
      },
      onSuccess: () => {
        setProgress(null);
        cacheRegistry.invalidate('movies-list');
        reload.reload();
      },
    }
  );

  return (
    <section class="p-1 space-y-3">
      <a href="/movies" class="bg-amber-200">movies</a>

      <header class="flex items-center gap-3">
        <h1 class="text-xl font-semibold">Watched ({entries.length})</h1>
        <button
          type="button"
          class="bg-blue-500 text-white px-3 py-1"
          disabled={importing}
          onClick={() => bulkImport({})}
        >
          {importing ? 'Importing…' : 'Bulk-import next 20'}
        </button>
        {progress && (
          <span class="text-sm">
            {progress.count} / {progress.total}
          </span>
        )}
      </header>

      {entries.length === 0 ? (
        <p>Nothing here yet. Mark a movie as watched to populate this list.</p>
      ) : (
        <ul class="space-y-2">
          {entries.map((e) => (
            <li key={e.watched.movieId} class="border-2 p-2 flex items-start gap-3">
              {e.watched.hasPhoto && (
                <img
                  src={`/api/watched/${e.watched.movieId}/photo`}
                  alt=""
                  class="w-16 h-16 object-cover"
                />
              )}
              <div class="flex-1">
                <a href={`/movies/${e.watched.movieId}`} class="font-semibold">
                  {e.movie?.title ?? `Movie #${e.watched.movieId}`}
                </a>
                <p class="text-xs text-gray-600">
                  {e.watched.watchedAt > 0
                    ? `watched ${new Date(e.watched.watchedAt).toLocaleDateString()}`
                    : 'notes/photo only'}
                </p>
                {e.watched.notes && <p class="text-sm mt-1">{e.watched.notes}</p>}
              </div>
              <button
                type="button"
                class="bg-red-500 text-white px-2 py-1 text-sm"
                disabled={removing}
                onClick={() => remove({ movieId: e.watched.movieId })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
WatchedPage.displayName = 'WatchedPage';

export default definePage(WatchedPage, { loader, cache });
