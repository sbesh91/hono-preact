import { getMovies } from '@/server/movies.js';
import { defineAction, type Loader } from '@hono-preact/iso';
import type { MoviesData } from '@/server/data/movies.js';

const serverLoader: Loader<{ movies: MoviesData }> = async () => {
  const movies = await getMovies();
  return { movies };
};

export default serverLoader;

export const serverActions = {
  addMovie: defineAction<{ title: string; year: string }, { ok: boolean }>(
    async (_ctx, payload) => {
      console.log('addMovie called with:', payload);
      return { ok: true };
    }
  ),
};
