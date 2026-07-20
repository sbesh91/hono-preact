import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { defineLoader, deny } from '@hono-preact/iso';
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
