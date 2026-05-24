import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { JSX } from 'preact';
import { defineApp } from '@hono-preact/iso';
import { renderPage } from '../render.js';
import { SPECULATION_RULES_TAG } from '../speculation-rules.js';

function LinkyPage(): JSX.Element {
  return (
    <html>
      <head></head>
      <body>
        <a href="/about">About</a>
        <a href="/logout" data-no-prefetch>Sign out</a>
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
});
