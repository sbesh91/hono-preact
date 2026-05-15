import { it, expect } from 'vitest';
import { Hono } from 'hono';
import type { RouteHook } from 'preact-iso';
import { defineLoader } from '@hono-preact/iso';
import { Loader } from '@hono-preact/iso/internal';
import { renderPage } from '../render.js';

// The loader fn reads c from the ALS scope seeded by renderPage.
it('a loader invoked during SSR receives the request c', async () => {
  let observedHeader: string | undefined = undefined;

  const probe = defineLoader(async (ctx) => {
    observedHeader = ctx.c.req.header('x-probe');
    return { ok: true };
  });

  const loc: RouteHook = {
    path: '/x',
    url: 'http://localhost/x',
    searchParams: {},
    pathParams: {},
  } as unknown as RouteHook;

  // Pass location directly to Loader (LoaderHost) so it doesn't need
  // RouteLocationsContext. The loader fn reads c from the ALS scope seeded
  // by renderPage rather than from an explicit argument.
  function Page() {
    return (
      <html>
        <body>
          <Loader loader={probe} location={loc}>
            <span>ok</span>
          </Loader>
        </body>
      </html>
    );
  }

  const app = new Hono();
  app.get('*', (c) => renderPage(c, <Page />));
  await app.request('http://localhost/x', { headers: { 'x-probe': 'hi' } });

  expect(observedHeader).toBe('hi');
});
