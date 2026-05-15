import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { defineServerGuard } from '@hono-preact/iso';
import { Guards } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { renderPage } from '../render.js';

const loc = {
  path: '/admin',
  url: 'http://localhost/admin',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

describe('renderPage installs HonoRequestContext.Provider', () => {
  it('a server guard inside the rendered tree receives the request c', async () => {
    let observedHeader: string | undefined = undefined;
    const probe = defineServerGuard(async (ctx, next) => {
      observedHeader = ctx.c.req.header('x-test');
      return next();
    });

    const Page = () => (
      <html>
        <body>
          <Guards guards={[probe]} location={loc}>
            <div>ok</div>
          </Guards>
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

  it('a server guard can short-circuit by returning a redirect, surfaced by renderPage', async () => {
    const redirectGuard = defineServerGuard(async () => ({ redirect: '/login' }));

    const Page = () => (
      <html>
        <body>
          <Guards guards={[redirectGuard]} location={loc}>
            <div>protected</div>
          </Guards>
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
