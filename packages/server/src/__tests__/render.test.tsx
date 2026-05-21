import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { useTitle, useLang, useMeta, useLink } from 'hoofd/preact';
import type { JSX } from 'preact';
import { LocationProvider, useLocation } from 'preact-iso';
import { env, redirect } from '@hono-preact/iso';
import { renderPage } from '../render.js';

function TitledPage() {
  useTitle('Test Title');
  return (
    <html>
      <head></head>
      <body>
        <div>hello</div>
      </body>
    </html>
  );
}

function UntitledPage() {
  return (
    <html>
      <head></head>
      <body>
        <div>no title</div>
      </body>
    </html>
  );
}

function RedirectingPage(): never {
  throw redirect('/login');
}

function XssTitle() {
  useTitle('</title><script>alert(1)</script><title>');
  return (
    <html>
      <head></head>
      <body></body>
    </html>
  );
}

function XssLang() {
  useLang('en" onload="alert(1)');
  return (
    <html>
      <head></head>
      <body></body>
    </html>
  );
}

function MetaPage() {
  useMeta({ name: 'description', content: 'A test page' });
  return (
    <html>
      <head></head>
      <body></body>
    </html>
  );
}

function LinkPage() {
  useLink({ rel: 'stylesheet', href: '/styles.css' });
  return (
    <html>
      <head></head>
      <body></body>
    </html>
  );
}

function LangPage() {
  useLang('fr-FR');
  return (
    <html>
      <head></head>
      <body></body>
    </html>
  );
}

function NoHeadPage() {
  return (
    <html>
      <body>
        <div>no head tag</div>
      </body>
    </html>
  );
}

function makeApp(Page: () => JSX.Element, options?: { defaultTitle?: string }) {
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
    const res = await makeApp(UntitledPage, {
      defaultTitle: 'Fallback',
    }).request('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Fallback</title>');
  });

  it('does not inject a <title> when neither useTitle nor defaultTitle is provided', async () => {
    const res = await makeApp(UntitledPage).request('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('<title>');
  });

  it('returns an HTTP redirect when a page throws a redirect outcome during render', async () => {
    const res = await makeApp(RedirectingPage).request('http://localhost/');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('escapes special characters in <title> content', async () => {
    const res = await makeApp(XssTitle).request('http://localhost/');
    const html = await res.text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;/title&gt;');
    expect(html).toContain(
      '<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;title&gt;</title>'
    );
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
      return (
        <html>
          <head></head>
          <body></body>
        </html>
      );
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

  it('does not add a lang attribute when useLang is not called and the layout already provides <html>', async () => {
    const res = await makeApp(UntitledPage).request('http://localhost/');
    const html = await res.text();
    expect(html).not.toContain('lang=');
  });

  it('falls back to lang="en-US" when the rendered tree has no <html> wrapper', async () => {
    function FragmentPage() {
      return (
        <>
          <head></head>
          <body>
            <div>fragment</div>
          </body>
        </>
      );
    }
    const res = await makeApp(FragmentPage).request('http://localhost/');
    const html = await res.text();
    expect(html).toContain('lang="en-US"');
  });

  it('returns 200 and preserves body content when component has no <head> tag', async () => {
    const res = await makeApp(NoHeadPage).request('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('no head tag');
  });

  it('does not race on globalThis.location across concurrent renders', async () => {
    // preact-iso's LocationProvider reads globalThis.location on mount.
    // If two concurrent renders interleave between setting and reading the
    // global, both renders end up with whichever URL was set last. This test
    // forces interleave by suspending each render mid-flight, then asserts
    // each response reflects ITS OWN request URL.
    function PathReporter() {
      const { path } = useLocation();
      return (
        <html>
          <head></head>
          <body>
            <div id="p">{path}</div>
          </body>
        </html>
      );
    }

    // A component that suspends once on first render, releasing only when
    // the outer test allows it. Concurrent renders both reach this suspend
    // point, allowing globalThis.location to be rewritten in between.
    let releaseA: () => void = () => {};
    let releaseB: () => void = () => {};
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });
    const gateB = new Promise<void>((r) => {
      releaseB = r;
    });
    let aSuspended = false;
    let bSuspended = false;

    function GateA() {
      if (!aSuspended) {
        aSuspended = true;
        throw gateA;
      }
      return null;
    }
    function GateB() {
      if (!bSuspended) {
        bSuspended = true;
        throw gateB;
      }
      return null;
    }

    function PageA() {
      return (
        <LocationProvider>
          <GateA />
          <PathReporter />
        </LocationProvider>
      );
    }
    function PageB() {
      return (
        <LocationProvider>
          <GateB />
          <PathReporter />
        </LocationProvider>
      );
    }

    const appA = new Hono();
    appA.get('*', (c) => renderPage(c, <PageA />));
    const appB = new Hono();
    appB.get('*', (c) => renderPage(c, <PageB />));

    // Start both renders; let them suspend at their gates.
    const pa = appA.request('http://localhost/route-a?x=1');
    const pb = appB.request('http://localhost/route-b?x=2');

    // Yield to let both renders mount LocationProvider and hit their gates.
    await new Promise((r) => setTimeout(r, 0));
    // Release in REVERSE order so the last setter of globalThis.location was B
    // but A finishes first; if A read from globalThis.location post-resume
    // it would report B's path.
    releaseA();
    releaseB();

    const [resA, resB] = await Promise.all([pa, pb]);
    const htmlA = await resA.text();
    const htmlB = await resB.text();
    expect(htmlA).toContain('>/route-a<');
    expect(htmlB).toContain('>/route-b<');
  });
});
