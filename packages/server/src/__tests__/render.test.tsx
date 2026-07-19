import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { useTitle, useLang, useMeta, useLink } from 'hoofd/preact';
import type { JSX } from 'preact';
import { LocationProvider, useLocation } from 'preact-iso';
import {
  defineApp,
  defineServerMiddleware,
  redirect,
  Head,
} from '@hono-preact/iso';
import { env } from '@hono-preact/iso/internal/runtime';
import { render as renderOutcome } from '@hono-preact/iso/page';
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

  // B7 defensive 500: render() outcomes are page-scope only. If an
  // app-level middleware leaks one through to translateRootOutcome, the
  // third branch in translateRootOutcome (outcome-translation.ts) should return 500 rather than crash.
  it('returns 500 when an app-level middleware throws a render outcome', async () => {
    const Alt = () => (
      <html>
        <head></head>
        <body>
          <div>alt</div>
        </body>
      </html>
    );
    const appConfig = defineApp({
      use: [
        defineServerMiddleware<'page'>(async () => {
          // Intentional misuse: render outcomes belong at page scope.
          throw renderOutcome(Alt);
        }),
      ],
    });

    const app = new Hono();
    app.get('*', (c) => renderPage(c, <UntitledPage />, { appConfig }));

    const res = await app.request('http://localhost/');
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain('render outcome');
  });

  // The app-use guard tier reads ctx.location.searchParams (the URL query) and
  // pathParams as ORDINARY objects: the prototype-chain param-read hazard is
  // closed structurally (no route can DECLARE a param named after an
  // Object.prototype member), so these do not need to be null-prototype. This
  // test pins that they behave like normal objects: Object.prototype methods
  // (`hasOwnProperty`) work, `Object.hasOwn`/`Object.keys` see only the real
  // query keys, and a real query param reads through.
  it('hands the app-use guard ordinary searchParams/pathParams (hasOwnProperty works, no phantom keys)', async () => {
    const seen: Record<string, unknown> = {};
    const appConfig = defineApp({
      use: [
        defineServerMiddleware<'page'>(async (ctx) => {
          const sp = ctx.location.searchParams;
          // `.hasOwnProperty` must not throw (it did when these were
          // null-prototype): the regression this test guards against.
          seen.hasToken = sp.hasOwnProperty('token');
          seen.hasConstructor = Object.hasOwn(sp, 'constructor');
          seen.keys = Object.keys(sp);
          seen.pathKeys = Object.keys(ctx.location.pathParams);
          seen.realQuery = sp.token;
        }),
      ],
    });

    const app = new Hono();
    app.get('*', (c) => renderPage(c, <UntitledPage />, { appConfig }));
    // URL OMITS `constructor` but sends a real `token`.
    await app.request('http://localhost/?token=abc');

    expect(seen.hasToken).toBe(true);
    // The request never supplied `constructor`, so it is not an OWN key even
    // though a plain object inherits `Object.prototype.constructor`.
    expect(seen.hasConstructor).toBe(false);
    expect(seen.keys).toEqual(['token']);
    expect(seen.pathKeys).toEqual([]);
    expect(seen.realQuery).toBe('abc');
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

// A layout that uses the framework's <Head> component (which renders a static
// <title>). This is the shape every scaffolded app and the docs site use, and
// the shape none of the tests above exercise (they all use a bare <head></head>
// with no static title). See issue #293.
function headLayout(
  opts: { defaultTitle?: string },
  ...children: JSX.Element[]
): JSX.Element {
  return (
    <html lang="en">
      <Head defaultTitle={opts.defaultTitle} />
      <body>
        <main id="app">{children}</main>
      </body>
    </html>
  );
}

const titleCount = (html: string): number =>
  (html.match(/<title[\s>]/gi) ?? []).length;

describe('renderPage — single <title> for <Head>-based layouts (#293)', () => {
  it('emits exactly one <title>, carrying the useTitle value, not the Head default', async () => {
    function Page() {
      useTitle('Real Page Title');
      return <div>hi</div>;
    }
    const app = new Hono();
    app.get('*', (c) =>
      renderPage(c, headLayout({ defaultTitle: 'Fallback' }, <Page />))
    );
    const html = await (await app.request('http://localhost/')).text();

    expect(titleCount(html)).toBe(1);
    expect(html).toContain('<title>Real Page Title</title>');
    expect(html).not.toContain('<title>Fallback</title>');
  });

  it('keeps the Head default as the single title when no page sets one', async () => {
    function Page() {
      return <div>hi</div>;
    }
    const app = new Hono();
    app.get('*', (c) =>
      renderPage(c, headLayout({ defaultTitle: 'Fallback' }, <Page />))
    );
    const html = await (await app.request('http://localhost/')).text();

    expect(titleCount(html)).toBe(1);
    expect(html).toContain('<title>Fallback</title>');
  });

  it('renderPage defaultTitle replaces the Head static title (one title, no duplicate)', async () => {
    function Page() {
      return <div>hi</div>;
    }
    const app = new Hono();
    app.get('*', (c) =>
      renderPage(c, headLayout({ defaultTitle: 'LayoutDefault' }, <Page />), {
        defaultTitle: 'RenderDefault',
      })
    );
    const html = await (await app.request('http://localhost/')).text();

    expect(titleCount(html)).toBe(1);
    expect(html).toContain('<title>RenderDefault</title>');
  });

  it('does not touch a <title> inside a body inline-SVG when replacing the head title', async () => {
    function Page() {
      useTitle('Real Page Title');
      return (
        <svg viewBox="0 0 1 1">
          <title>Icon accessible name</title>
          <rect width="1" height="1" />
        </svg>
      );
    }
    const app = new Hono();
    app.get('*', (c) =>
      renderPage(c, headLayout({ defaultTitle: 'Fallback' }, <Page />))
    );
    const html = await (await app.request('http://localhost/')).text();

    // The SVG's <title> survives; only the head's static title is replaced.
    expect(html).toContain('<title>Icon accessible name</title>');
    const headHtml = html.slice(0, html.indexOf('</head>'));
    expect(titleCount(headHtml)).toBe(1);
    expect(headHtml).toContain('<title>Real Page Title</title>');
    expect(headHtml).not.toContain('<title>Fallback</title>');
  });
});
