import dot from 'dotenv';
import { Hono } from 'hono';
import { prerender } from 'preact-iso/prerender';
import { env } from './iso/is-browser.js';
import { Layout } from './server/layout.js';
import { location } from './server/middleware/location.js';
import { getMovie, getMovies } from './server/movies.js';

const dev = process.env.NODE_ENV === 'development';
dot.config({
  debug: dev,
});
export const app = new Hono();

env.current = 'server';

app
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

    return c.html(
      `<!doctype html>
      <html lang="en-US">
        ${html}
      </html>`
    );
  });

export default app;
