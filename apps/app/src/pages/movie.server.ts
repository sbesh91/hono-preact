import { getMovie } from '@/server/movies.js';
import type { Loader } from '@hono-preact/iso';

const serverLoader: Loader<{ movie: any }> = async ({ location }) => {
  const movie = await getMovie(location.pathParams.id);
  return { movie };
};

export default serverLoader;
