import { moviesData } from './data/movies.js';
import { movieData } from './data/movie.js';

export async function getMovies() {
  return moviesData;
}

export async function getMovie(id: string) {
  return movieData[id] ?? null;
}
