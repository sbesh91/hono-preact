import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import dot from 'dotenv';
import { Hono } from 'hono';
import { prerender } from 'preact-iso/prerender';
import { env } from './iso/is-browser.js';
import { Layout } from './server/layout.js';
import { compression } from './server/middleware/compress.js';
import { location } from './server/middleware/location.js';
import { getMovie, getMovies } from './server/movies.js';

dot.config();
export const app = new Hono();
const port = 8000;

env.current = 'server';

app
  .use(compression())
  .use(
    '/static/*',
    serveStatic({
      root: './dist',
    })
  )
  .get('/api/movies', async (c) => {
    const movies = await getMovies();
    return c.json(movies);
  })
  .get('/api/movies/:id', async (c) => {
    const movie = await getMovie(c.req.param('id'));
    return c.json(movie);
  })
  .use(location)
  .get('*', async (c) => {
    const { html } = await prerender(<Layout context={c} />);
    return c.html(`<!DOCTYPE html><html lang="en-US">${html}</html>`);
  });

if (process.env.NODE_ENV === 'production') {
  console.log(`Server is running on http://localhost:${port}`);

  serve({
    fetch: app.fetch,
    port,
  });
} else {
  console.log('starting in dev mode');
}

export default app;
