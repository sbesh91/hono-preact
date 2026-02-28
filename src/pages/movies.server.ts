import { getMovies } from '@/server/movies.js';
import type { LocationHook } from 'preact-iso';

export async function serverLoader({}: { location: LocationHook }) {
  const movies = await getMovies();
  return { movies };
}
