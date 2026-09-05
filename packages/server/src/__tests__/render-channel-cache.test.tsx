import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { defineApp, defineServerMiddleware } from '@hono-preact/iso';
import { publishToChannel } from '@hono-preact/iso/internal';
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
