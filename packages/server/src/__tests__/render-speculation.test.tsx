import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { JSX } from 'preact';
import { defineApp, defineLoader } from '@hono-preact/iso';
import { Loader } from '@hono-preact/iso/internal';
import type { RouteHook } from 'preact-iso';
import { renderPage } from '../render.js';
import { SPECULATION_RULES_TAG } from '../speculation-rules.js';

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

function LinkyPage(): JSX.Element {
  return (
    <html>
      <head></head>
      <body>
        <a href="/about">About</a>
        <a href="/logout" data-no-prefetch>
          Sign out
        </a>
      </body>
    </html>
  );
}

async function renderAndGetBody(
  options?: Parameters<typeof renderPage>[2]
): Promise<string> {
  const app = new Hono();
  app.get('*', (c) => renderPage(c, <LinkyPage />, options));
  const res = await app.request('http://localhost/');
  return await res.text();
}

describe('renderPage speculation rules', () => {
  it('omits the speculation rules tag when AppConfig is not provided', async () => {
    const body = await renderAndGetBody();
    expect(body).not.toContain('speculationrules');
  });

  it('omits the speculation rules tag when speculation is false', async () => {
    const appConfig = defineApp({ speculation: false });
    const body = await renderAndGetBody({ appConfig });
    expect(body).not.toContain('speculationrules');
  });

  it('omits the speculation rules tag when speculation is omitted on AppConfig', async () => {
    const appConfig = defineApp({});
    const body = await renderAndGetBody({ appConfig });
    expect(body).not.toContain('speculationrules');
  });

  it('emits the speculation rules tag exactly once in <head> when speculation is true', async () => {
    const appConfig = defineApp({ speculation: true });
    const body = await renderAndGetBody({ appConfig });

    const occurrences = body.split(SPECULATION_RULES_TAG).length - 1;
    expect(occurrences).toBe(1);

    const headEnd = body.indexOf('</head>');
    const tagAt = body.indexOf(SPECULATION_RULES_TAG);
    expect(headEnd).toBeGreaterThan(-1);
    expect(tagAt).toBeGreaterThan(-1);
    expect(tagAt).toBeLessThan(headEnd);
  });

  it('preserves data-no-prefetch attribute on rendered links', async () => {
    const appConfig = defineApp({ speculation: true });
    const body = await renderAndGetBody({ appConfig });
    expect(body).toContain('data-no-prefetch');
  });

  it('emits the speculation rules tag inside the streaming response body', async () => {
    // Streaming-loader path takes a different branch in render.tsx (the
    // ReadableStream split-at-</body> path). headTags are still built once
    // upstream, so the speculation tag must land in the initial chunk that
    // precedes the streaming script tags.
    const streamingLoader = defineLoader<{ count: number }>(async function* () {
      yield { count: 1 };
      yield { count: 2 };
    });
    const appConfig = defineApp({ speculation: true });
    const app = new Hono();
    app.get('*', (c) =>
      renderPage(
        c,
        <html>
          <head></head>
          <body>
            <Loader loader={streamingLoader} location={loc}>
              <a href="/about">About</a>
            </Loader>
          </body>
        </html>,
        { appConfig }
      )
    );
    const res = await app.request('http://localhost/');
    const body = await readBody(res);

    expect(body).toContain('__HP_STREAM__');
    expect(body).toContain(SPECULATION_RULES_TAG);

    const tagAt = body.indexOf(SPECULATION_RULES_TAG);
    const firstStreamPush = body.indexOf('__HP_STREAM__.push');
    expect(tagAt).toBeGreaterThan(-1);
    expect(firstStreamPush).toBeGreaterThan(-1);
    expect(tagAt).toBeLessThan(firstStreamPush);
  });
});
