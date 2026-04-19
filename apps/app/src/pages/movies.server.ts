import { getMovies } from '@/server/movies.js';
import type { Loader } from '@/iso/loader.js';
// import { createGuard } from '../iso/guard.js';

const serverLoader: Loader<{ movies: any }> = async () => {
  const movies = await getMovies();
  return { movies };
};

export default serverLoader;

// export const serverGuards = [
//   createGuard(async (_ctx, _next) => {
//     return { redirect: '/test' };
//   }),
// ];
