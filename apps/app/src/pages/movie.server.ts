import { getMovie } from '@/server/movies.js';
import type { Loader } from '@hono-preact/iso';
import type { Movie } from '@/server/data/movie.js';

const serverLoader: Loader<{ movie: Movie | null }> = async ({ location }) => {
  const movie = await getMovie(location.pathParams.id);
  return { movie };
};

export default serverLoader;
