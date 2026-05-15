// TMDB canonical genre id mapping. Names are lowercase; lookup is exact-match
// against the trimmed query. Synonyms ('sci-fi' / 'science fiction') alias to
// the same id.
const GENRE_BY_NAME: Record<string, number> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  'sci-fi': 878,
  'science fiction': 878,
  thriller: 53,
  war: 10752,
  western: 37,
};

/** Returns the TMDB genre id if `q` matches a known genre name, else null. */
export function matchGenre(q: string): number | null {
  return GENRE_BY_NAME[q.trim().toLowerCase()] ?? null;
}
