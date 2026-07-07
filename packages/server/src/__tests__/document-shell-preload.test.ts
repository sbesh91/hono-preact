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
