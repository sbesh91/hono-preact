import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { Page, defineServerMiddleware, redirect, deny } from '@hono-preact/iso';
import { PageMiddlewareHost } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { renderPage } from '../render.js';

const loc = {
  path: '/admin',
  url: 'http://localhost/admin',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

// A real Hono Context, minted by driving one throwaway request, for tests
// that call `renderPage` directly rather than through `app.request`.
async function ctx() {
  const app = new Hono();
  let captured!: import('hono').Context;
  app.get('*', (c) => {
    captured = c;
    return c.text('ok');
  });
  await app.request('http://localhost/admin');
  return captured;
}

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

  // B6: deny() thrown by a page-scope server middleware during SSR must
  // produce an HTTP error response (not an HTML fallback). The path goes:
  // dispatchServer returns { kind: 'outcome', outcome: deny(...) }, the
  // HostConsumer rethrows the outcome, RouteBoundary's ErrorBoundary must
  // detect isOutcome and rethrow (rather than coercing to new Error and
  // rendering errorFallback), and renderPage's outer catch translates to
  // a status-coded text response.
  //
  // <Page> is in the tree to supply RouteBoundary; an explicit
  // <PageMiddlewareHost> is nested inside it to run the gate middleware.
  // Without the RouteBoundary rethrow the deny outcome would be coerced
  // to `new Error('[object Object]')` by getDerivedStateFromError, the
  // boundary would render its null errorFallback, and the response would
  // arrive as 200 with empty body instead of 403 with the deny message.
  it('a server middleware can short-circuit by throwing a deny outcome', async () => {
    const gate = defineServerMiddleware<'page'>(async () => {
      throw deny(403, 'Forbidden');
    });

    const Layout = () => (
      <html>
        <body>
          <Page>
            <PageMiddlewareHost use={[gate]} location={loc}>
              <div>secret</div>
            </PageMiddlewareHost>
          </Page>
        </body>
      </html>
    );

    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));

    const res = await app.request('http://localhost/admin');
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toBe('Forbidden');
  });

  // A malformed page-level `use` entry (a bad import lands as `undefined`, a
  // typo'd brand as an unbranded object) must fail the SSR render outright
  // rather than being silently bucketed as a stream observer (which does not
  // gate) or swallowed by the suspense machinery. `startChain` in
  // page-middleware-host.tsx throws synchronously, during render, before it
  // ever returns the promise `prerender` suspends on; this pins that the
  // synchronous throw propagates out of `prerender` (and out of `renderPage`)
  // rather than being absorbed as an empty/partial page.
  it('a malformed page-level `use` entry surfaces the classification error rather than being swallowed', async () => {
    const c = await ctx();

    // The `use` prop type cannot express an invalid entry, which is the point
    // of the test; go through `unknown` to build one.
    const bad = null as unknown as ReturnType<typeof defineServerMiddleware>;

    const Layout = () => (
      <html>
        <body>
          <Page>
            <PageMiddlewareHost use={[bad]} location={loc}>
              <div>secret</div>
            </PageMiddlewareHost>
          </Page>
        </body>
      </html>
    );

    await expect(renderPage(c, <Layout />)).rejects.toThrow(
      'Invalid `use` entry at index 0 of the page `use` for /admin: null.'
    );
  });
});
