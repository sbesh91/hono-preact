import { describe, it, expect } from 'vitest';
import { routePreloadTags } from '../route-preload-tags.js';

describe('routePreloadTags', () => {
  it('returns empty string when the map is undefined', () => {
    expect(routePreloadTags(undefined, '/docs/quick-start')).toBe('');
  });

  it('returns empty string when no pattern matches', () => {
    const map = { '/docs/quick-start': { high: ['/static/a.js'], low: [] } };
    expect(routePreloadTags(map, '/somewhere/else')).toBe('');
  });

  it('returns empty string when the matched pattern has no hrefs', () => {
    const map = { '/docs/quick-start': { high: [], low: [] } };
    expect(routePreloadTags(map, '/docs/quick-start')).toBe('');
  });

  it('emits layout chunks at default priority and view chunks with fetchpriority=low', () => {
    const map = {
      '/docs/quick-start': {
        high: ['/static/DocsLayout.js'],
        low: ['/static/quick-start.js'],
      },
    };
    const out = routePreloadTags(map, '/docs/quick-start');
    expect(out).toContain(
      '<link rel="modulepreload" href="/static/DocsLayout.js" crossorigin />'
    );
    expect(out).toContain(
      '<link rel="modulepreload" href="/static/quick-start.js" crossorigin fetchpriority="low" />'
    );
    // The layout link must NOT carry fetchpriority; the view link must.
    expect(out).not.toContain('DocsLayout.js" crossorigin fetchpriority');
    expect(out.match(/fetchpriority="low"/g)?.length).toBe(1);
  });

  it('emits high links before low links', () => {
    const map = {
      '/p': { high: ['/static/layout.js'], low: ['/static/view.js'] },
    };
    const out = routePreloadTags(map, '/p');
    expect(out.indexOf('/static/layout.js')).toBeLessThan(
      out.indexOf('/static/view.js')
    );
  });

  it('picks the most specific pattern when several match (literal over param)', () => {
    const map = {
      '/docs/:slug': { high: [], low: ['/static/generic.js'] },
      '/docs/quick-start': { high: [], low: ['/static/specific.js'] },
    };
    const out = routePreloadTags(map, '/docs/quick-start');
    expect(out).toContain('/static/specific.js');
    expect(out).not.toContain('/static/generic.js');
  });

  it('matches a parameterized pattern for a concrete URL', () => {
    const map = {
      '/demo/projects/:projectId': {
        high: ['/static/project-layout.js'],
        low: ['/static/project.js'],
      },
    };
    const out = routePreloadTags(map, '/demo/projects/42');
    expect(out).toContain('/static/project.js');
  });
});
