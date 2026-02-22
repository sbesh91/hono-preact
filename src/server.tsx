import dot from 'dotenv';
import { Hono } from 'hono';
import { prerender } from 'preact-iso/prerender';
import { env } from './iso/is-browser.js';
import { Layout } from './server/layout.js';
import { compression } from './server/middleware/compress.js';
import { location } from './server/middleware/location.js';
import { getMovie, getMovies } from './server/movies.js';

dot.config({
  debug: process.env.NODE_ENV === 'development',
});
export const app = new Hono();
const port = 8000;

env.current = 'server';

app
  .use(compression())
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

export default app;
