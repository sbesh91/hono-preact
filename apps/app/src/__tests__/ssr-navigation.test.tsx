// @vitest-environment node
//
// Integration test for the SSR navigation pipeline.
//
// Note: apps/app/src/server.tsx uses import.meta.glob and import.meta.env
// (Vite compile-time APIs) that cannot be executed in a raw Node/vitest
// environment. This test exercises the same renderPage + Page + Route
// pipeline by constructing a minimal Hono app inline, which is functionally
// equivalent and avoids the Vite-specific build-step dependency.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { LocationProvider } from 'preact-iso';
import { type ComponentChildren } from 'preact';
import { definePage, Route, Router } from '@hono-preact/iso';
import { location, renderPage } from '@hono-preact/server';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'hp-page-fragment': { children?: ComponentChildren };
    }
  }
}

// Minimal stand-in for the /test page: no CSS, no loader.
function TestContent() {
  return (
    <section data-testid="test-page">
      <a href="/">home</a>
    </section>
  );
}
TestContent.displayName = 'Test';

const TestPage = definePage(TestContent);

// Minimal layout that mirrors apps/app/src/server/layout.tsx without
// the Vite-specific imports (CSS URLs, import.meta.env.PROD).
function Layout() {
  return (
    <LocationProvider>
      <html>
        <head />
        <body>
          <section id="app">
            <Router>
              {[<Route key="test" path="/test" component={TestPage} navigate="ssr" />]}
            </Router>
          </section>
        </body>
      </html>
    </LocationProvider>
  );
}

function makeApp() {
  const app = new Hono();
  app.use(location).get('*', (c) => renderPage(c, <Layout />, { defaultTitle: 'hono-preact' }));
  return app;
}

describe('SSR navigation end-to-end', () => {
  it('returns a fragment envelope for an SSR-mode route', async () => {
    const res = await makeApp().request('/test', {
      headers: { 'X-HP-Navigate': 'fragment' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe('envelope');
    expect(body.events[0].html).not.toContain('hp-page-fragment');
    expect(body.events[0].html.length).toBeGreaterThan(0);
    expect(body.events[0].head).toBeDefined();
  });

  it('returns a full HTML document without the header', async () => {
    const res = await makeApp().request('/test');
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('<!doctype html>');
    expect(text).not.toContain('hp-page-fragment');
  });
});
