// apps/app/src/pages/movies.server.ts
import { getMovies } from '@/server/movies.js';
import { createCache, defineAction, defineLoader, type LoaderFn } from '@hono-preact/iso';
import type { MoviesData } from '@/server/data/movies.js';
import { listWatched, markWatched, unmarkWatched } from '@/server/watched.js';

const serverLoader: LoaderFn<{ movies: MoviesData; watchedIds: number[] }> = async () => {
  const [movies, watched] = await Promise.all([getMovies(), listWatched()]);
  return { movies, watchedIds: watched.map((w) => w.movieId) };
};

export default serverLoader;

export const loader = defineLoader<{ movies: MoviesData; watchedIds: number[] }>('movies', serverLoader);
export const cache = createCache<{ movies: MoviesData; watchedIds: number[] }>('movies-list');

export const serverActions = {
  toggleWatched: defineAction<{ movieId: number; watched: boolean }, { ok: boolean }>(
    async (_ctx, { movieId, watched }) => {
      if (watched) await markWatched(movieId);
      else await unmarkWatched(movieId);
      return { ok: true };
    }
  ),
};
