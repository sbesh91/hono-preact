import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { useTitle, useLang } from 'hoofd/preact';
import type { JSX } from 'preact';
import { GuardRedirect, env } from '@hono-preact/iso';
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

function XssTitle() {
  useTitle('</title><script>alert(1)</script><title>');
  return <html><head></head><body></body></html>;
}

function XssLang() {
  useLang('en" onload="alert(1)');
  return <html><head></head><body></body></html>;
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

  it('escapes special characters in <title> content', async () => {
    const res = await makeApp(XssTitle).request('http://localhost/');
    const html = await res.text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;/title&gt;');
    expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;title&gt;</title>');
  });

  it('escapes special characters in the lang attribute', async () => {
    const res = await makeApp(XssLang).request('http://localhost/');
    const html = await res.text();
    expect(html).not.toContain('onload="');
    expect(html).toContain('lang="en&quot; onload=&quot;alert(1)"');
  });

  it('sets env.current to server during render and restores it after', async () => {
    let envDuringRender: string | undefined;

    function EnvSnoop() {
      envDuringRender = env.current;
      return <html><head></head><body></body></html>;
    }

    const originalEnv = env.current;
    await makeApp(EnvSnoop).request('http://localhost/');

    expect(envDuringRender).toBe('server');
    expect(env.current).toBe(originalEnv);
  });
});
