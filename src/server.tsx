import dot from 'dotenv';
import { Hono } from 'hono';
import { createDispatcher, HoofdProvider } from 'hoofd/preact';
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
    const dispatcher = createDispatcher();
    const { html } = await prerender(
      <HoofdProvider value={dispatcher}>
        <Layout context={c} />
      </HoofdProvider>
    );

    const { title, lang, metas = [], links = [] } = dispatcher.toStatic();

    const toAttrs = (obj: Record<string, string | undefined>) =>
      Object.entries(obj)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
        .join(' ');

    const headTags = [
      `<title>${title ?? 'hono-preact'}</title>`,
      ...metas.map((m) => `<meta ${toAttrs(m as Record<string, string>)} />`),
      ...links.map((l) => `<link ${toAttrs(l as Record<string, string>)} />`),
    ].join('\n        ');

    // c.header('Cache-Control', 'no-store');
    return c.html(
      `<!doctype html>
      <html lang="${lang ?? 'en-US'}">
        ${html.replace('</head>', `${headTags}\n      </head>`)}
      </html>`
    );
  });

export default app;
