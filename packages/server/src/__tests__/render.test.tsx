import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { useTitle, useLang, useMeta, useLink } from 'hoofd/preact';
import type { ComponentChildren, JSX } from 'preact';
import { GuardRedirect, env } from '@hono-preact/iso';
import { renderPage } from '../render.js';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'hp-page-fragment': { children?: ComponentChildren };
    }
  }
}

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

function MetaPage() {
  useMeta({ name: 'description', content: 'A test page' });
  return <html><head></head><body></body></html>;
}

function LinkPage() {
  useLink({ rel: 'stylesheet', href: '/styles.css' });
  return <html><head></head><body></body></html>;
}

function LangPage() {
  useLang('fr-FR');
  return <html><head></head><body></body></html>;
}

function NoHeadPage() {
  return <html><body><div>no head tag</div></body></html>;
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

  it('injects <meta> tags from useMeta into SSR output', async () => {
    const res = await makeApp(MetaPage).request('http://localhost/');
    const html = await res.text();
    expect(html).toContain('name="description"');
    expect(html).toContain('content="A test page"');
  });

  it('injects <link> tags from useLink into SSR output', async () => {
    const res = await makeApp(LinkPage).request('http://localhost/');
    const html = await res.text();
    expect(html).toContain('rel="stylesheet"');
    expect(html).toContain('href="/styles.css"');
  });

  it('sets the lang attribute from useLang', async () => {
    const res = await makeApp(LangPage).request('http://localhost/');
    const html = await res.text();
    expect(html).toContain('lang="fr-FR"');
  });

  it('defaults lang to en-US when useLang is not called', async () => {
    const res = await makeApp(UntitledPage).request('http://localhost/');
    const html = await res.text();
    expect(html).toContain('lang="en-US"');
  });

  it('returns 200 and preserves body content when component has no <head> tag', async () => {
    const res = await makeApp(NoHeadPage).request('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('no head tag');
  });
});

describe('renderPage fragment mode', () => {
  it('returns a JSON envelope when X-HP-Navigate: fragment is set', async () => {
    const app = new Hono();
    app.get('/test', (c) =>
      renderPage(
        c,
        <html>
          <body>
            <hp-page-fragment>
              <section id="loader-foo" data-loader="{&quot;ok&quot;:true}">hello</section>
            </hp-page-fragment>
          </body>
        </html>
      )
    );
    const res = await app.request('/test', {
      headers: { 'X-HP-Navigate': 'fragment' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe('envelope');
    expect(body.events[0].html).toContain('loader-foo');
    expect(body.events[0].html).toContain('hello');
    expect(body.events[0].html).not.toContain('hp-page-fragment');
  });

  it('returns full HTML document when header is absent', async () => {
    const app = new Hono();
    app.get('/test', (c) =>
      renderPage(c, <html><body><p>hi</p></body></html>)
    );
    const res = await app.request('/test');
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<!doctype html>');
  });

  it('returns a redirect event (not 302) when GuardRedirect is thrown in fragment mode', async () => {
    const app = new Hono();
    app.get('/test', (c) =>
      renderPage(
        c,
        <html>
          <body>
            <RedirectingPage />
          </body>
        </html>
      )
    );
    const res = await app.request('/test', {
      headers: { 'X-HP-Navigate': 'fragment' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe('redirect');
    expect(body.events[0].location).toBe('/login');
  });

  it('returns a fallback event when no hp-page-fragment marker is present', async () => {
    const app = new Hono();
    app.get('/test', (c) =>
      renderPage(c, <html><body><p>no fragment here</p></body></html>)
    );
    const res = await app.request('/test', {
      headers: { 'X-HP-Navigate': 'fragment' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe('fallback');
  });
});
