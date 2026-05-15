import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { renderPage } from '../render.js';
import { defineLoader } from '@hono-preact/iso';
import { Loader } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';

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

  it('wraps loader output with a data-loader element carrying the first-chunk JSON', async () => {
    const loader = defineLoader(async () => ({ msg: 'hello-preload' }));
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
    // The loader's rendered output must be inside an element carrying
    // data-loader=<JSON>. Client hydration relies on this for preload pickup;
    // without it Suspense kicks the SSR'd children out during hydration.
    // Preact escapes the JSON's quotes as &quot; in the attribute, so match
    // for the entity-escaped form.
    expect(body).toMatch(/data-loader="\{&quot;msg&quot;:&quot;hello-preload&quot;\}"/);
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

