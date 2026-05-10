// apps/app/src/pages/movies.server.ts
import { getMovies } from '@/server/movies.js';
import { defineAction, defineLoader } from '@hono-preact/iso';
import { listWatched, markWatched, unmarkWatched } from '@/server/watched.js';

const serverLoader = async () => {
  const [movies, watched] = await Promise.all([getMovies(), listWatched()]);
  return { movies, watchedIds: watched.map((w) => w.movieId) };
};

export default serverLoader;

export const loader = defineLoader(serverLoader);

export const serverActions = {
  toggleWatched: defineAction<{ movieId: number; watched: boolean }, { ok: boolean }>(
    async (_ctx, { movieId, watched }) => {
      if (watched) await markWatched(movieId);
      else await unmarkWatched(movieId);
      return { ok: true };
    }
  ),
};
