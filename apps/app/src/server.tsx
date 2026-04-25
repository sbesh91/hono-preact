import { Hono } from 'hono';
import { env } from '@hono-preact/iso';
import { Layout } from './server/layout.js';
import {
  actionsHandler,
  loadersHandler,
  location,
  renderPage,
} from '@hono-preact/server';
import { getMovie, getMovies } from './server/movies.js';

const dev = process.env.NODE_ENV === 'development';
if (dev) {
  const { default: dot } = await import('dotenv');
  dot.config({ debug: true });
}
export const app = new Hono();

env.current = 'server';

app
  .post('/__actions', actionsHandler(import.meta.glob('./pages/*.server.ts')))
  .post('/__loaders', loadersHandler(import.meta.glob('./pages/*.server.ts')))
  .get('/api/movies', async (c) => {
    const movies = await getMovies();
    return c.json(movies);
  })
  .get('/api/movies/:id', async (c) => {
    const movie = await getMovie(c.req.param('id'));
    return c.json(movie);
  })
  .use(location)
  .get('*', (c) =>
    renderPage(c, <Layout context={c} />, { defaultTitle: 'hono-preact' })
  );

export default app;
