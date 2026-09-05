import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  defineApp,
  defineLoader,
  defineServerMiddleware,
  redirect,
  deny,
} from '@hono-preact/iso';
import {
  Loader,
  publishToChannel,
  CHANNEL_HEADER,
} from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { renderPage } from '../render.js';

/**
 * A document whose chain published carries that visitor's snapshot inline, so a
 * shared cache storing it would hand one visitor's session hint to the next.
 */
function Layout() {
  return (
    <html>
      <head></head>
      <body>
        <div>page</div>
      </body>
    </html>
  );
}

const publishing = defineServerMiddleware(async (_ctx, next) => {
  publishToChannel('demo', { signedIn: true });
  await next();
});

const appConfig = defineApp({ use: [publishing] });

describe('a publishing document is not shared-cacheable', () => {
  it('sets private, no-store when the app set no Cache-Control', async () => {
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />, { appConfig }));
    const res = await app.request('http://localhost/');

    expect(await res.text()).toContain('__HP_CHANNELS__');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it("leaves the application's own Cache-Control alone", async () => {
    const app = new Hono();
    app.get('*', (c) => {
      c.header('Cache-Control', 'public, max-age=60');
      return renderPage(c, <Layout />, { appConfig });
    });
    const res = await app.request('http://localhost/');

    expect(await res.text()).toContain('__HP_CHANNELS__');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('sets nothing when the document carries no snapshot', async () => {
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />, { appConfig: {} }));
    const res = await app.request('http://localhost/');

    expect(await res.text()).not.toContain('__HP_CHANNELS__');
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});

// The streamed document takes a different response path (the pump builds the
// Response, not c.html), and that path always writes its own Cache-Control.
describe('a publishing streamed document is not shared-cacheable either', () => {
  const loc = {
    path: '/',
    pathParams: {},
    searchParams: {},
  } as unknown as RouteHook;
  const streaming = defineLoader<{ count: number }>(async function* () {
    yield { count: 1 };
    yield { count: 2 };
  });

  function StreamingPage() {
    return (
      <html>
        <head></head>
        <body>
          <Loader mode={{ kind: 'single' }} loader={streaming} location={loc}>
            <p>streaming</p>
          </Loader>
        </body>
      </html>
    );
  }

  it('keeps no-transform while adding private, no-store', async () => {
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <StreamingPage />, { appConfig }));
    const res = await app.request('http://localhost/');
    // Drain so the pump finishes before the assertion's process tick.
    await res.text();

    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-store, no-transform'
    );
  });

  it("overrides the application's own Cache-Control", async () => {
    // The streamed response writes Cache-Control from a header literal, so the
    // app's value cannot survive this path either way. Given that, a
    // per-visitor document must land on the private directive rather than on
    // the shared-cacheable default.
    const app = new Hono();
    app.get('*', (c) => {
      c.header('Cache-Control', 'public, max-age=60');
      return renderPage(c, <StreamingPage />, { appConfig });
    });
    const res = await app.request('http://localhost/');
    await res.text();

    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-store, no-transform'
    );
  });

  it('leaves the streamed default alone when nothing published', async () => {
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <StreamingPage />, { appConfig: {} }));
    const res = await app.request('http://localhost/');
    await res.text();

    expect(res.headers.get('Cache-Control')).toBe('no-transform');
  });
});

// The RPC handlers take the snapshot in a `finally`, so a chain that publishes
// and then denies or redirects still carries it. SSR matches them.
describe('a snapshot survives however the root chain settles', () => {
  it('carries the snapshot on a redirect from the publishing chain', async () => {
    const redirecting = defineServerMiddleware(async () => {
      publishToChannel('demo', { signedIn: false });
      throw redirect('/login');
    });
    const app = new Hono();
    app.get('*', (c) =>
      renderPage(c, <Layout />, {
        appConfig: defineApp({ use: [redirecting] }),
      })
    );
    const res = await app.request('http://localhost/');

    expect(res.status).toBe(302);
    expect(res.headers.get(CHANNEL_HEADER)).toContain('signedIn');
  });

  it('carries the snapshot on a deny from the publishing chain', async () => {
    const denying = defineServerMiddleware(async () => {
      publishToChannel('demo', { signedIn: false });
      throw deny({ status: 401, message: 'nope' });
    });
    const app = new Hono();
    app.get('*', (c) =>
      renderPage(c, <Layout />, { appConfig: defineApp({ use: [denying] }) })
    );
    const res = await app.request('http://localhost/');

    expect(res.status).toBe(401);
    expect(res.headers.get(CHANNEL_HEADER)).toContain('signedIn');
  });

  it('inlines a publish made on the way back out of the chain', async () => {
    const afterNext = defineServerMiddleware(async (_ctx, next) => {
      await next();
      publishToChannel('demo', { signedIn: true });
    });
    const app = new Hono();
    app.get('*', (c) =>
      renderPage(c, <Layout />, { appConfig: defineApp({ use: [afterNext] }) })
    );
    const res = await app.request('http://localhost/');

    expect(await res.text()).toContain('__HP_CHANNELS__');
  });
});
