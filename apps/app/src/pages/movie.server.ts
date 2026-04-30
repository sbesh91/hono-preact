// apps/app/src/pages/movie.server.ts
import { getMovie } from '@/server/movies.js';
import { defineAction, defineLoader, type LoaderFn } from '@hono-preact/iso';
import type { Movie } from '@/server/data/movie.js';
import {
  getWatched,
  markWatched,
  setNotes,
  setPhoto,
  unmarkWatched,
  type WatchedRecord,
} from '@/server/watched.js';

const serverLoader: LoaderFn<{ movie: Movie | null; watched: WatchedRecord | null }> =
  async ({ location }) => {
    const idStr = location.pathParams.id;
    const id = Number(idStr);
    const [movie, watched] = await Promise.all([
      getMovie(idStr),
      Number.isFinite(id) ? getWatched(id) : Promise.resolve(null),
    ]);
    return { movie, watched };
  };

export default serverLoader;

export const loader = defineLoader<{ movie: Movie | null; watched: WatchedRecord | null }>('movie', serverLoader);

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
