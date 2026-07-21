import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { defineLoader, deny, redirect, Page } from '@hono-preact/iso';
import { Loader } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { renderPage } from '../render.js';

const board = defineLoader(async () => {
  throw deny(404, "No project named 'nope'.");
});

// `.View` is a FACTORY: call it with the render fn (and optional
// `{ errorFallback }`) to get a component, then render that component.
const BoardView = board.View(() => <div>never</div>, {
  errorFallback: (e: Error) => (
    <div class="panel">Board error: {e.message}</div>
  ),
});

const Layout = () => (
  <html>
    <body>
      <BoardView />
    </body>
  </html>
);

describe('SSR loader deny renders errorFallback at the deny status', () => {
  it('returns a full document with the branded fallback at 404', async () => {
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/demo/projects/nope');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('class="panel"');
    expect(body).toContain("No project named 'nope'.");
    // Baked for hydration:
    expect(body).toContain('data-loader-deny="');
  });
});

// A loader with NO local errorFallback, used under a Page that HAS one.
const bareLoader = defineLoader(async () => {
  throw deny(404, 'nope');
});
const BareView = bareLoader.View(() => <div>never</div>);

describe('SSR loader deny boundary matrix', () => {
  it('a loader deny with no local fallback is bare text even under a page errorFallback (SSR cannot catch it)', async () => {
    // A page-level errorFallback cannot catch an SSR loader deny: a throw from
    // the suspended DataReader subtree escapes ancestor boundaries in
    // preact-render-to-string; client-side navigation is unaffected.
    const Layout = () => (
      <html>
        <body>
          <Page
            errorFallback={(e: Error) => <div class="page-fb">{e.message}</div>}
          >
            <BareView />
          </Page>
        </body>
      </html>
    );
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('<!doctype html>');
    expect(body).not.toContain('page-fb');
    expect(body.trim()).toBe('nope');
  });

  it('a loader deny with NO fallback anywhere is still bare text at the status', async () => {
    const Layout = () => (
      <html>
        <body>
          <BareView />
        </body>
      </html>
    );
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('<!doctype html>');
    expect(body.trim()).toBe('nope');
  });

  it('a loader redirect during SSR is a real 302 (not a rendered fallback)', async () => {
    const redirecting = defineLoader(async () => {
      throw redirect('/login');
    });
    const RedirectingView = redirecting.View(() => <div>never</div>, {
      errorFallback: <div class="fb">err</div>,
    });
    const Layout = () => (
      <html>
        <body>
          <RedirectingView />
        </body>
      </html>
    );
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('deny headers ride the document response', async () => {
    const withHeader = defineLoader(async () => {
      throw deny(403, 'no', { headers: { 'x-deny': 'yes' } });
    });
    const WithHeaderView = withHeader.View(() => <div>never</div>, {
      errorFallback: (e: Error) => <div class="fb">{e.message}</div>,
    });
    const Layout = () => (
      <html>
        <body>
          <WithHeaderView />
        </body>
      </html>
    );
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(403);
    expect(res.headers.get('x-deny')).toBe('yes');
  });

  it('a deny header survives on a STREAMING page (not clobbered by the pump default)', async () => {
    // Regression for the streaming path: `c.body(...)`'s header-object arg
    // does a `set()` per key, so the pump's hardcoded 'no-transform' used to
    // win over a deny's 'no-store' even though `applyOutcomeHeaders` had
    // already written it onto `c`. A page with a sibling streaming loader
    // forces `renderPage` down the `streamDocumentResponse` branch.
    const loc = { path: '/x', pathParams: {}, searchParams: {} } as RouteHook;
    const denying = defineLoader(async () => {
      throw deny(403, 'no', { headers: { 'Cache-Control': 'no-store' } });
    });
    const DenyingView = denying.View(() => <div>never</div>, {
      errorFallback: (e: Error) => <div class="fb">{e.message}</div>,
    });
    const streaming = defineLoader<{ n: number }>(async function* () {
      yield { n: 1 };
    });
    const Layout = () => (
      <html>
        <body>
          <DenyingView />
          <Loader loader={streaming} location={loc}>
            <p>streaming</p>
          </Loader>
        </body>
      </html>
    );
    const app = new Hono();
    app.get('*', (c) => renderPage(c, <Layout />));
    const res = await app.request('http://localhost/x');
    expect(res.status).toBe(403);
    // Deny wins over the pump's own default.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // Structural headers are preserved.
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Transfer-Encoding')).toBe('chunked');
    // Confirm this really took the streaming branch.
    const body = await res.text();
    expect(body).toContain('__HP_STREAM__');
  });
});
