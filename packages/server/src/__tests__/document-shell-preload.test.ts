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
