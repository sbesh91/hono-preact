import { getMovies } from '@/server/movies.js';
import type { Loader } from '@/iso/loader.js';

const serverLoader: Loader<{ movies: any }> = async () => {
  const movies = await getMovies();
  return { movies };
};

export default serverLoader;
