import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { useTitle } from 'hoofd/preact';
import type { JSX } from 'preact';
import { GuardRedirect } from '@hono-preact/iso';
import { renderPage } from '../render.js';

function TitledPage() {
  useTitle('Test Title');
  return (
    <html>
      <head></head>
      <body><div>hello</div></body>
    </html>
  );
}

function UntitledPage() {
  return (
    <html>
      <head></head>
      <body><div>no title</div></body>
    </html>
  );
}

function RedirectingPage(): never {
  throw new GuardRedirect('/login');
}

function makeApp(
  Page: () => JSX.Element,
  options?: { defaultTitle?: string }
) {
  const app = new Hono();
  app.get('*', (c) => renderPage(c, <Page />, options));
  return app;
}

describe('renderPage', () => {
  it('injects <title> from useTitle into SSR output', async () => {
    const res = await makeApp(TitledPage).request('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Test Title</title>');
  });

  it('falls back to defaultTitle when no useTitle is called', async () => {
    const res = await makeApp(UntitledPage, { defaultTitle: 'Fallback' }).request(
      'http://localhost/'
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Fallback</title>');
  });

  it('returns an empty title when neither useTitle nor defaultTitle is provided', async () => {
    const res = await makeApp(UntitledPage).request('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title></title>');
  });

  it('returns a redirect when GuardRedirect is thrown during render', async () => {
    const res = await makeApp(RedirectingPage).request('http://localhost/');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });
});
