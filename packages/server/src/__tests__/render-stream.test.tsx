import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { renderPage } from '../render.js';
import { defineLoader, definePage } from '@hono-preact/iso';
import { Loader } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { loader as moviesListLoader } from '../../../../apps/app/src/pages/movies-list.server.js';

// Helper: read a streaming response body fully to a string.
async function readBody(res: Response): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

const loc = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

describe('renderPage: streaming SSR', () => {
  it('preserves single-shot behavior when no streaming loaders are present', async () => {
    const loader = defineLoader(async () => ({ msg: 'hi' }));
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>static</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('static');
    expect(body).not.toContain('__HP_STREAM__');
  });

  it('streams chunks as inline script tags for an async-generator loader', async () => {
    const loader = defineLoader<{ count: number }>(async function* () {
      yield { count: 1 };
      yield { count: 2 };
      yield { count: 3 };
    });
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>streaming</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('__HP_STREAM__');
    // First chunk is baked into the initial render; chunks 2 and 3 arrive as script tags.
    expect(body).toContain('window.__HP_STREAM__.push');
    expect(body).toContain('"count":2');
    expect(body).toContain('"count":3');
    expect(body).toContain('window.__HP_STREAM__.end');
    // Confirm the response terminates (controller.close() was called).
    expect(body.length).toBeGreaterThan(0);
  });

  it('emits an error script tag when the generator throws', async () => {
    const loader = defineLoader(async function* (): AsyncGenerator<{ count: number }> {
      yield { count: 1 };
      throw new Error('mid-stream');
    });
    const app = new Hono();
    app.get('/', (c) =>
      renderPage(
        c,
        <Loader loader={loader} location={loc}>
          <p>streaming</p>
        </Loader>
      )
    );
    const res = await app.request('/');
    const body = await readBody(res);
    expect(body).toContain('window.__HP_STREAM__.error');
    expect(body).toContain('"message":"mid-stream"');
  });
});

describe('renderPage: movies-list streaming search SSR', () => {
  it('streams bucket chunks when q is present', async () => {
    const PageBody = () => {
      const data = moviesListLoader.useData() as { mode: string };
      return <p data-testid="mode">{data.mode}</p>;
    };
    const Page = definePage(PageBody, { loader: moviesListLoader });

    const app = new Hono();
    app.get('/movies', (c) =>
      renderPage(
        c,
        <Page path="/movies" pathParams={{}} searchParams={{ q: 'moana' }} />
      )
    );

    const res = await app.request('/movies?q=moana');
    const body = await readBody(res);
    expect(body).toContain('__HP_STREAM__');
    // The first bucket chunk is baked into the initial render; the remaining
    // 3 bucket yields arrive as inline script pushes.
    const pushCount = (body.match(/__HP_STREAM__\.push/g) ?? []).length;
    expect(pushCount).toBeGreaterThanOrEqual(3);
  }, 10_000);
});
