import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { JSX } from 'preact';
import { renderPage } from '../render.js';
import type { RoutePreloadMap } from '../route-preload-tags.js';

function Page(): JSX.Element {
  return (
    <html>
      <head></head>
      <body>
        <main>hello</main>
      </body>
    </html>
  );
}

async function renderAt(
  path: string,
  routePreload?: RoutePreloadMap
): Promise<string> {
  const app = new Hono();
  app.get('*', (c) => renderPage(c, <Page />, { routePreload }));
  const res = await app.request('http://localhost' + path);
  return await res.text();
}

const MAP: RoutePreloadMap = {
  '/docs/quick-start': {
    high: ['/static/DocsLayout-abc.js'],
    low: ['/static/quick-start-def.js'],
  },
};

describe('renderPage route modulepreload', () => {
  it('injects layout (high) and view (low-priority) modulepreload links inside <head>', async () => {
    const body = await renderAt('/docs/quick-start', MAP);
    const layoutTag =
      '<link rel="modulepreload" href="/static/DocsLayout-abc.js" crossorigin />';
    const viewTag =
      '<link rel="modulepreload" href="/static/quick-start-def.js" crossorigin fetchpriority="low" />';
    expect(body).toContain(layoutTag);
    expect(body).toContain(viewTag);

    const headEnd = body.indexOf('</head>');
    expect(headEnd).toBeGreaterThan(-1);
    expect(body.indexOf(layoutTag)).toBeLessThan(headEnd);
    expect(body.indexOf(viewTag)).toBeLessThan(headEnd);
  });

  it('injects nothing when the request path does not match any pattern', async () => {
    const body = await renderAt('/some/other/page', MAP);
    expect(body).not.toContain('modulepreload');
  });

  it('injects nothing when no route-preload map is provided', async () => {
    const body = await renderAt('/docs/quick-start');
    expect(body).not.toContain('modulepreload');
  });
});
