// apps/app/src/pages/watched.server.ts
import { getMovie, getMovies } from '@/server/movies.js';
import { createCache, defineAction, defineLoader, type LoaderFn } from '@hono-preact/iso';
import type { Movie } from '@/server/data/movie.js';
import {
  listWatched,
  markWatched,
  removeWatched,
} from '@/server/watched.js';

export type WireWatched = {
  movieId: number;
  watchedAt: number;
  notes: string;
  hasPhoto: boolean;
};
type Entry = { movie: Movie | null; watched: WireWatched };

const serverLoader: LoaderFn<{ entries: Entry[] }> = async () => {
  const records = await listWatched();
  const entries: Entry[] = await Promise.all(
    records.map(async (w) => ({
      movie: await getMovie(String(w.movieId)),
      watched: {
        movieId: w.movieId,
        watchedAt: w.watchedAt,
        notes: w.notes,
        hasPhoto: w.photo !== undefined,
      },
    }))
  );
  return { entries };
};

export default serverLoader;

export const loader = defineLoader<{ entries: Entry[] }>(serverLoader);
export const cache = createCache<{ entries: Entry[] }>('watched');

export const serverActions = {
  removeWatched: defineAction<{ movieId: number }, { ok: boolean }>(
    async (_ctx, { movieId }) => {
      await removeWatched(movieId);
      return { ok: true };
    }
  ),

  bulkImportWatched: defineAction<Record<string, never>, ReadableStream<Uint8Array<ArrayBuffer>>>(async () => {
    const target = (await getMovies()).results.slice(0, 20);
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async start(controller) {
        let count = 0;
        for (const m of target) {
          await markWatched(m.id);
          count++;
          controller.enqueue(
            encoder.encode(JSON.stringify({ count, total: target.length }) + '\n')
          );
          await new Promise((r) => setTimeout(r, 150));
        }
        controller.close();
      },
    });
  }),
};
