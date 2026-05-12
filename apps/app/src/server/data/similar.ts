import { moviesData } from './movies.js';

/**
 * Pick 4 movies whose genre_ids overlap most with the target movie.
 * Deterministic: ties broken by id ascending.
 */
export function pickSimilar(movieId: string): number[] {
  const id = Number(movieId);
  const target = moviesData.results.find((m) => m.id === id);
  if (!target) return [];
  const targetGenres = new Set(target.genre_ids);

  const scored = moviesData.results
    .filter((m) => m.id !== id)
    .map((m) => {
      let overlap = 0;
      for (const g of m.genre_ids) if (targetGenres.has(g)) overlap++;
      return { id: m.id, overlap };
    });

  // Sort by overlap desc, then by id asc for stability.
  scored.sort((a, b) => b.overlap - a.overlap || a.id - b.id);

  return scored.slice(0, 4).map((s) => s.id);
}
