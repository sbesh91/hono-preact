import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { defineServerMiddleware, redirect } from '@hono-preact/iso';
import { PageMiddlewareHost } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { renderPage } from '../render.js';

const loc = {
  path: '/admin',
  url: 'http://localhost/admin',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

describe('renderPage installs HonoRequestContext.Provider', () => {
  it('a server middleware inside the rendered tree receives the request c', async () => {
    let observedHeader: string | undefined = undefined;
    const probe = defineServerMiddleware<'page'>(async (ctx, next) => {
      observedHeader = ctx.c.req.header('x-test');
      await next();
    });

    const Page = () => (
      <html>
        <body>
          <PageMiddlewareHost use={[probe]} location={loc}>
            <div>ok</div>
          </PageMiddlewareHost>
        </body>
      </html>
    );

    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Page />));

    const res = await app.request('http://localhost/admin', {
      headers: { 'x-test': 'hello' },
    });
    expect(res.status).toBe(200);
    expect(observedHeader).toBe('hello');
  });

  it('a server middleware can short-circuit by throwing a redirect outcome', async () => {
    const gate = defineServerMiddleware<'page'>(async () => {
      throw redirect('/login');
    });

    const Page = () => (
      <html>
        <body>
          <PageMiddlewareHost use={[gate]} location={loc}>
            <div>protected</div>
          </PageMiddlewareHost>
        </body>
      </html>
    );

    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Page />));

    const res = await app.request('http://localhost/admin');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });
});
