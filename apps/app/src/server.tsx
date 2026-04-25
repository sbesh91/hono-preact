import { Hono } from 'hono';
import { env } from '@hono-preact/iso';
import { Layout } from './server/layout.js';
import {
  actionsHandler,
  loadersHandler,
  location,
  renderPage,
} from '@hono-preact/server';
import { getWatched } from './server/watched.js';

const dev = process.env.NODE_ENV === 'development';
if (dev) {
  const { default: dot } = await import('dotenv');
  dot.config({ debug: true });
}
export const app = new Hono();

env.current = 'server';

app
  .post('/__loaders', loadersHandler(import.meta.glob('./pages/*.server.ts')))
  .post('/__actions', actionsHandler(import.meta.glob('./pages/*.server.ts')))
  .get('/api/watched/:movieId/photo', async (c) => {
    const id = Number(c.req.param('movieId'));
    if (!Number.isFinite(id)) return c.notFound();
    const rec = await getWatched(id);
    if (!rec?.photo) return c.notFound();
    return new Response(new Blob([rec.photo.bytes], { type: rec.photo.contentType }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  })
  .use(location)
  .get('*', (c) =>
    renderPage(c, <Layout context={c} />, { defaultTitle: 'hono-preact' })
  );

export default app;
