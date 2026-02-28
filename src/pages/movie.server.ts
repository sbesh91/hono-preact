import { getMovie } from '@/server/movies.js';
import type { LocationHook } from 'preact-iso';

export async function serverLoader({ location }: { location: LocationHook }) {
  const movie = await getMovie(location.pathParams.id);
  return { movie };
}
