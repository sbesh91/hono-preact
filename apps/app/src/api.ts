import { Hono } from 'hono';
import { getWatched } from './server/watched.js';

export default new Hono().get(
  '/api/watched/:movieId/photo',
  async (c) => {
    const id = Number(c.req.param('movieId'));
    if (!Number.isFinite(id)) return c.notFound();
    const rec = await getWatched(id);
    if (!rec?.photo) return c.notFound();
    return new Response(
      new Blob([rec.photo.bytes], { type: rec.photo.contentType }),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
);
