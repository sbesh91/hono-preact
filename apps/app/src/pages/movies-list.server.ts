// apps/app/src/pages/movies-list.server.ts
import { getMovies } from '@/server/movies.js';
import { defineAction, defineLoader, type LoaderCtx } from '@hono-preact/iso';
import { listWatched, markWatched, unmarkWatched } from '@/server/watched.js';
import type { MoviesData, MovieSummary } from '@/server/data/movies.js';
import { matchGenre } from '@/server/data/genre-map.js';

export type SearchResults =
  | { mode: 'list'; movies: MoviesData; watchedIds: number[] }
  | {
      mode: 'buckets';
      query: string;
      buckets: {
        exact: MovieSummary[];
        titleSubstring: MovieSummary[];
        overview: MovieSummary[];
        genre: MovieSummary[];
      };
      watchedIds: number[];
    };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const emptyBuckets = () => ({
  exact: [] as MovieSummary[],
  titleSubstring: [] as MovieSummary[],
  overview: [] as MovieSummary[],
  genre: [] as MovieSummary[],
});

const serverLoader = async function* (
  ctx: LoaderCtx
): AsyncGenerator<SearchResults> {
  const q = (ctx.location.searchParams.q ?? '').toString().trim();
  const [movies, watched] = await Promise.all([getMovies(), listWatched()]);
  const watchedIds = watched.map((w) => w.movieId);

  if (!q) {
    yield { mode: 'list', movies, watchedIds };
    return;
  }

  if (q === 'crash') {
    yield { mode: 'buckets', query: q, buckets: emptyBuckets(), watchedIds };
    await sleep(300);
    throw new Error('Search index unavailable (demo)');
  }

  const norm = q.toLowerCase();
  const buckets = emptyBuckets();

  await sleep(150);
  if (ctx.signal.aborted) return;
  buckets.exact = movies.results.filter((m) =>
    m.title.toLowerCase().startsWith(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(250);
  if (ctx.signal.aborted) return;
  const exactIds = new Set(buckets.exact.map((m) => m.id));
  buckets.titleSubstring = movies.results.filter(
    (m) => !exactIds.has(m.id) && m.title.toLowerCase().includes(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(350);
  if (ctx.signal.aborted) return;
  const titleIds = new Set([
    ...exactIds,
    ...buckets.titleSubstring.map((m) => m.id),
  ]);
  buckets.overview = movies.results.filter(
    (m) => !titleIds.has(m.id) && m.overview.toLowerCase().includes(norm)
  );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };

  await sleep(450);
  if (ctx.signal.aborted) return;
  const seen = new Set([...titleIds, ...buckets.overview.map((m) => m.id)]);
  const matchedGenreId = matchGenre(norm);
  buckets.genre =
    matchedGenreId == null
      ? []
      : movies.results.filter(
          (m) => !seen.has(m.id) && m.genre_ids.includes(matchedGenreId)
        );
  yield { mode: 'buckets', query: q, buckets: { ...buckets }, watchedIds };
};

export default serverLoader;
export const loader = defineLoader<SearchResults>(serverLoader);

export const serverActions = {
  toggleWatched: defineAction<
    { movieId: number; watched: boolean },
    { ok: boolean }
  >(async (_ctx, { movieId, watched }) => {
    if (watched) await markWatched(movieId);
    else await unmarkWatched(movieId);
    return { ok: true };
  }),
};
