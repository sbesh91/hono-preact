import { describe, it, expect, vi, afterEach } from 'vitest';
import { assembleDocument } from '../document-shell.js';

const shell = '<html><head><title>t</title></head><body>x</body></html>';
// A Layout that owns <html> but emits no </head> (the warn/drop case).
const noHeadShell = '<html><body>x</body></html>';

afterEach(() => vi.restoreAllMocks());

describe('assembleDocument: modulepreload hints', () => {
  it('injects a <link rel="modulepreload"> for each closure module into <head>', () => {
    const out = assembleDocument({
      html: shell,
      head: {},
      preloadModules: ['/static/a.js', '/static/b.js'],
    });
    expect(out).toContain(
      '<link rel="modulepreload" href="/static/a.js" fetchpriority="low" />'
    );
    expect(out).toContain(
      '<link rel="modulepreload" href="/static/b.js" fetchpriority="low" />'
    );
    // Hints must land inside <head>, before the closing tag.
    expect(out.indexOf('/static/a.js')).toBeLessThan(out.indexOf('</head>'));
  });

  it('injects no modulepreload markup when the closure is empty', () => {
    const out = assembleDocument({ html: shell, head: {}, preloadModules: [] });
    expect(out).not.toContain('modulepreload');
  });

  it('injects no modulepreload markup when preloadModules is omitted', () => {
    const out = assembleDocument({ html: shell, head: {} });
    expect(out).not.toContain('modulepreload');
  });

  it('does NOT warn about a missing </head> when only preload hints would be dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assembleDocument({
      html: noHeadShell,
      head: {},
      preloadModules: ['/static/a.js'],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('injects the route chunks as fetchpriority=low hints alongside the closure', () => {
    const out = assembleDocument({
      html: shell,
      head: {},
      preloadModules: ['/static/a.js'],
      routePreloadModules: ['/static/home.js'],
    });
    expect(out).toContain(
      '<link rel="modulepreload" href="/static/home.js" fetchpriority="low" />'
    );
    // Both closure and route hints land inside <head>.
    expect(out.indexOf('/static/home.js')).toBeLessThan(out.indexOf('</head>'));
  });

  it('does NOT warn about a missing </head> when only route preload tags would be dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assembleDocument({
      html: noHeadShell,
      head: {},
      routePreloadModules: ['/static/home.js'],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("still warns when the Layout would drop the user's own head content", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assembleDocument({
      html: noHeadShell,
      head: { title: 'Real title' },
      preloadModules: ['/static/a.js'],
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('assembleDocument: route stylesheets', () => {
  it('injects a <link rel="stylesheet"> for each route sheet, after the user head tags', () => {
    const out = assembleDocument({
      html: '<html><head><link rel="stylesheet" href="/global.css" /></head><body>x</body></html>',
      head: {},
      routeStyleSheets: ['/static/home.css'],
    });
    expect(out).toContain('<link rel="stylesheet" href="/static/home.css" />');
    // Route sheet lands inside <head> and AFTER the global sheet (cascade order).
    expect(out.indexOf('/static/home.css')).toBeLessThan(
      out.indexOf('</head>')
    );
    expect(out.indexOf('/global.css')).toBeLessThan(
      out.indexOf('/static/home.css')
    );
  });

  it('injects nothing when routeStyleSheets is empty or omitted', () => {
    const out = assembleDocument({
      html: shell,
      head: {},
      routeStyleSheets: [],
    });
    expect(out).not.toContain('rel="stylesheet"');
    const out2 = assembleDocument({ html: shell, head: {} });
    expect(out2).not.toContain('rel="stylesheet"');
  });

  it('WARNS about a missing </head> when route stylesheets would be dropped (render-critical, unlike preload hints)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assembleDocument({
      html: noHeadShell,
      head: {},
      routeStyleSheets: ['/static/home.css'],
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('WARNS when a fragment (no <html>) drops render-critical route stylesheets (no <head> to inject into)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assembleDocument({
      html: '<div>x</div>',
      head: {},
      routeStyleSheets: ['/static/x.css'],
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does NOT warn for a fragment with no route stylesheets (the supported quiet case)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assembleDocument({
      html: '<div>x</div>',
      head: {},
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('injects global stylesheets after user head tags and before route sheets', () => {
    const html = assembleDocument({
      html: '<html><head><meta charset="utf-8"/></head><body></body></html>',
      head: {},
      globalStyleSheets: ['/static/global-a.css'],
      routeStyleSheets: ['/static/home-b.css'],
    });
    const global = html.indexOf('href="/static/global-a.css"');
    const route = html.indexOf('href="/static/home-b.css"');
    expect(global).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(global);
    expect(html).toContain(
      '<link rel="stylesheet" href="/static/global-a.css" />'
    );
  });

  it('warns when a fragment render would drop the global sheet', () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      assembleDocument({
        html: '<div>fragment</div>',
        head: {},
        globalStyleSheets: ['/static/global-a.css'],
      });
    } finally {
      console.warn = original;
    }
    expect(warnings.join('\n')).toContain('render-critical');
  });
});

describe('assembleDocument: font preloads', () => {
  it('injects a crossorigin font <link rel=preload> with an inferred type for each AppConfig font', () => {
    const out = assembleDocument({
      html: shell,
      head: {},
      appConfig: { fonts: ['/static/regular-abc.woff2'] },
    });
    expect(out).toContain(
      '<link rel="preload" as="font" type="font/woff2" href="/static/regular-abc.woff2" crossorigin="" />'
    );
  });

  it('places font preloads before the low-priority modulepreload hints', () => {
    const out = assembleDocument({
      html: shell,
      head: {},
      preloadModules: ['/static/a.js'],
      appConfig: { fonts: ['/static/regular-abc.woff2'] },
    });
    expect(out.indexOf('/static/regular-abc.woff2')).toBeLessThan(
      out.indexOf('/static/a.js')
    );
  });

  it('injects nothing when there are no fonts', () => {
    const out = assembleDocument({ html: shell, head: {}, appConfig: {} });
    expect(out).not.toContain('as="font"');
  });

  it('does NOT warn about a missing </head> when only font preloads would be dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assembleDocument({
      html: noHeadShell,
      head: {},
      appConfig: { fonts: ['/static/regular-abc.woff2'] },
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('assembleDocument: full head ordering', () => {
  it('orders the five injected segments: font preload, modulepreload, user head tag, global stylesheet, route stylesheet', () => {
    const out = assembleDocument({
      html: shell,
      head: { metas: [{ name: 'description', content: 'A page' }] },
      appConfig: { fonts: ['/static/regular-abc.woff2'] },
      preloadModules: ['/static/a.js'],
      globalStyleSheets: ['/static/global-a.css'],
      routeStyleSheets: ['/static/home-b.css'],
    });

    const fontIdx = out.indexOf(
      '<link rel="preload" as="font" type="font/woff2" href="/static/regular-abc.woff2" crossorigin="" />'
    );
    const preloadIdx = out.indexOf(
      '<link rel="modulepreload" href="/static/a.js" fetchpriority="low" />'
    );
    const metaIdx = out.indexOf('<meta name="description" content="A page" />');
    const globalIdx = out.indexOf(
      '<link rel="stylesheet" href="/static/global-a.css" />'
    );
    const routeIdx = out.indexOf(
      '<link rel="stylesheet" href="/static/home-b.css" />'
    );

    expect(fontIdx).toBeGreaterThan(-1);
    expect(preloadIdx).toBeGreaterThan(fontIdx);
    expect(metaIdx).toBeGreaterThan(preloadIdx);
    expect(globalIdx).toBeGreaterThan(metaIdx);
    expect(routeIdx).toBeGreaterThan(globalIdx);
  });
});

describe('assembleDocument: $-pattern safety in head injection', () => {
  // String.prototype.replace expands `$&`/`$``/`$'`/`$<name>` in a STRING
  // replacement; a title (or other head-derived content) containing one of
  // these sequences must render literally, not be treated as a replacement
  // pattern. A regression here would duplicate/mangle the </head> marker or
  // corrupt the <html lang> tag depending on which literal sneaks through.
  it('a title containing "$&" renders literally and does not duplicate </head>', () => {
    const out = assembleDocument({
      html: shell,
      head: { title: 'Weird $& Title' },
    });
    expect(out).toContain('<title>Weird $&amp; Title</title>');
    expect(out.split('</head>').length - 1).toBe(1);
  });

  it('a title containing "$`" renders literally', () => {
    const out = assembleDocument({
      html: shell,
      head: { title: 'Weird $` Title' },
    });
    expect(out).toContain('<title>Weird $` Title</title>');
    expect(out.split('</head>').length - 1).toBe(1);
  });

  it('a lang value containing "$1" renders literally in the <html lang> tag', () => {
    const out = assembleDocument({
      html: shell,
      head: { lang: 'en-$1' },
    });
    expect(out).toContain('<html lang="en-$1"');
    // Not corrupted into swallowing the captured trailing character.
    expect(out).not.toContain('<html lang="en-$1">>');
  });
});

describe('assembleDocument: single <title> (#293)', () => {
  const titleCount = (html: string): number =>
    (html.match(/<title[\s>]/gi) ?? []).length;

  it('replaces the Layout static <title> with the resolved one (no duplicate)', () => {
    // `shell` carries the Layout's own <title>t</title>; the resolved hoofd
    // title must be the document's ONLY title, not a second one after it.
    const out = assembleDocument({ html: shell, head: { title: 'Real' } });
    expect(titleCount(out)).toBe(1);
    expect(out).toContain('<title>Real</title>');
    expect(out).not.toContain('<title>t</title>');
  });

  it('strips an EMPTY Layout <title> (as <Head/> with no defaultTitle renders it)', () => {
    // `<Head/>` renders `<title></title>`. The resolved title must replace it,
    // not sit after it. Guards the zero-width match in stripHeadTitle's
    // `[\s\S]*?`: a `[\s\S]+?` mutant leaves the empty tag and ships two titles.
    const emptyTitleShell =
      '<html><head><title></title></head><body>x</body></html>';
    const out = assembleDocument({
      html: emptyTitleShell,
      head: { title: 'Real' },
    });
    expect(titleCount(out)).toBe(1);
    expect(out).toContain('<title>Real</title>');
  });

  it('leaves a body inline-SVG <title> untouched when the head has no static title', () => {
    // The load-bearing case for stripHeadTitle's head-slice scoping: the first
    // <title> in document order lives in the BODY (the head has none). Without
    // the `slice(0, headEnd)`, the strip would delete the SVG's accessible name.
    const svgShell =
      '<html><head></head><body><svg viewBox="0 0 1 1"><title>Icon label</title></svg></body></html>';
    const out = assembleDocument({ html: svgShell, head: { title: 'Real' } });
    const headHtml = out.slice(0, out.indexOf('</head>'));
    expect(titleCount(headHtml)).toBe(1);
    expect(headHtml).toContain('<title>Real</title>');
    // The SVG's own <title> (in the body) survives.
    expect(out).toContain('<title>Icon label</title>');
  });

  it('keeps the Layout static <title> when no title is resolved (fallback path unchanged)', () => {
    const out = assembleDocument({ html: shell, head: {} });
    expect(titleCount(out)).toBe(1);
    expect(out).toContain('<title>t</title>');
  });
});
