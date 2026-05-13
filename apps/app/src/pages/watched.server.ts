// apps/app/src/pages/watched.server.ts
import { getMovie, getMovies } from '@/server/movies.js';
import { defineAction, defineLoader } from '@hono-preact/iso';
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

const serverLoader = async () => {
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

export const serverLoaders = {
  default: defineLoader(serverLoader),
};

export const serverActions = {
  removeWatched: defineAction<{ movieId: number }, { ok: boolean }>(
    async (_ctx, { movieId }) => {
      await removeWatched(movieId);
      return { ok: true };
    }
  ),

  bulkImportWatched: defineAction(async function* (ctx) {
    const target = (await getMovies()).results.slice(0, 20);
    for (let i = 0; i < target.length; i++) {
      if (ctx.signal.aborted) return { imported: i };
      await markWatched(target[i].id);
      yield { count: i + 1, total: target.length };
      await new Promise((r) => setTimeout(r, 150));
    }
    return { imported: target.length };
  }),
};
