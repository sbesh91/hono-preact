// apps/app/src/pages/movie.server.ts
import { getMovie } from '@/server/movies.js';
import {
  defineAction,
  defineLoader,
  type LoaderCtx,
} from '@hono-preact/iso';
import {
  getWatched,
  listWatched,
  markWatched,
  setNotes,
  setPhoto,
  unmarkWatched,
} from '@/server/watched.js';
import type { Movie } from '@/server/data/movie.js';
import type { MovieSummary } from '@/server/data/movies.js';
import { moviesData } from '@/server/data/movies.js';
import { generateCast, type CastMember } from '@/server/data/cast.js';
import { generateSummary } from '@/server/data/summaries.js';
import { pickSimilar } from '@/server/data/similar.js';
import { generateBoxOffice, type BoxOfficeStats } from '@/server/data/box-office.js';

type WatchedRecord = Awaited<ReturnType<typeof getWatched>>;

export type DetailStream = {
  movie: Movie | null;
  watched: WatchedRecord;
  watchedCount: number;
  summary: string;
  cast: CastMember[];
  similar: MovieSummary[];
  boxOffice: BoxOfficeStats | null;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const serverLoader = async function* (
  ctx: LoaderCtx
): AsyncGenerator<DetailStream> {
  if (ctx.signal.aborted) return;
  const id = ctx.location.pathParams.id;
  if (!id) return;

  const [movie, watched, allWatched] = await Promise.all([
    getMovie(id),
    Number.isFinite(Number(id)) ? getWatched(Number(id)) : Promise.resolve(null),
    listWatched(),
  ]);

  let state: DetailStream = {
    movie,
    watched,
    watchedCount: allWatched.length,
    summary: '',
    cast: [],
    similar: [],
    boxOffice: null,
  };
  yield state;

  if (!movie) return;

  const summaryWords = generateSummary(id).split(' ');
  const castList = generateCast(id);
  const similarIds = pickSimilar(id);

  let summaryIdx = 0;
  let castIdx = 0;
  let similarIdx = 0;
  let boxOfficeDone = false;
  let tick = 0;
  const TICK_MS = 50;

  while (true) {
    if (ctx.signal.aborted) return;
    let changed = false;
    const next: DetailStream = { ...state };

    if (summaryIdx < summaryWords.length) {
      next.summary = next.summary
        ? `${next.summary} ${summaryWords[summaryIdx]}`
        : summaryWords[summaryIdx];
      summaryIdx++;
      changed = true;
    }

    if (castIdx < castList.length && tick % 3 === 0) {
      next.cast = [...next.cast, castList[castIdx]];
      castIdx++;
      changed = true;
    }

    if (similarIdx < similarIds.length && tick % 8 === 0) {
      const m = moviesData.results.find((x) => x.id === similarIds[similarIdx]);
      if (m) next.similar = [...next.similar, m];
      similarIdx++;
      changed = true;
    }

    if (!boxOfficeDone && tick >= 40) {
      if (ctx.location.searchParams.demo === 'crash') {
        throw new Error('box-office service unavailable (demo)');
      }
      next.boxOffice = generateBoxOffice(id);
      boxOfficeDone = true;
      changed = true;
    }

    if (changed) {
      state = next;
      yield state;
    }

    const allDone =
      summaryIdx >= summaryWords.length &&
      castIdx >= castList.length &&
      similarIdx >= similarIds.length &&
      boxOfficeDone;
    if (allDone) return;

    await sleep(TICK_MS);
    tick++;
  }
};

export const serverLoaders = {
  default: defineLoader<DetailStream>(serverLoader),
};

export const serverActions = {
  toggleWatched: defineAction<{ movieId: number; watched: boolean }, { ok: boolean }>(
    async (_ctx, { movieId, watched }) => {
      if (watched) await markWatched(movieId);
      else await unmarkWatched(movieId);
      return { ok: true };
    }
  ),

  setNotes: defineAction<{ movieId: string; notes: string }, { ok: boolean }>(
    async (_ctx, { movieId, notes }) => {
      const id = Number(movieId);
      if (!Number.isFinite(id)) throw new Error('movieId must be numeric');
      await setNotes(id, notes);
      return { ok: true };
    }
  ),

  setPhoto: defineAction<{ movieId: string; photo: File }, { ok: boolean }>(
    async (_ctx, { movieId, photo }) => {
      const id = Number(movieId);
      if (!Number.isFinite(id)) throw new Error('movieId must be numeric');
      const buf = new Uint8Array(await photo.arrayBuffer());
      await setPhoto(id, {
        contentType: photo.type || 'application/octet-stream',
        bytes: buf,
        filename: photo.name,
      });
      return { ok: true };
    }
  ),
};
