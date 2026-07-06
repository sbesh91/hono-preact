import { describe, it, expect } from 'vitest';
import { assembleDocument } from '../document-shell.js';

const shell = '<html><head><title>t</title></head><body>x</body></html>';

describe('assembleDocument — modulepreload hints', () => {
  it('injects a <link rel="modulepreload"> for each closure module into <head>', () => {
    const out = assembleDocument({
      html: shell,
      head: {},
      preloadModules: ['/static/a.js', '/static/b.js'],
    });
    expect(out).toContain('<link rel="modulepreload" href="/static/a.js" />');
    expect(out).toContain('<link rel="modulepreload" href="/static/b.js" />');
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
});
