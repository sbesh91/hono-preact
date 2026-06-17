import { describe, it, expect } from 'vitest';
import { routePreloadTags } from '../route-preload-tags.js';

describe('routePreloadTags', () => {
  it('returns empty string when the map is undefined', () => {
    expect(routePreloadTags(undefined, '/docs/quick-start')).toBe('');
  });

  it('returns empty string when no pattern matches', () => {
    const map = { '/docs/quick-start': ['/static/a.js'] };
    expect(routePreloadTags(map, '/somewhere/else')).toBe('');
  });

  it('returns empty string when the matched pattern has no hrefs', () => {
    const map = { '/docs/quick-start': [] };
    expect(routePreloadTags(map, '/docs/quick-start')).toBe('');
  });

  it('emits one modulepreload link per href, with crossorigin', () => {
    const map = {
      '/docs/quick-start': ['/static/DocsLayout.js', '/static/quick-start.js'],
    };
    const out = routePreloadTags(map, '/docs/quick-start');
    expect(out).toContain(
      '<link rel="modulepreload" href="/static/DocsLayout.js" crossorigin />'
    );
    expect(out).toContain(
      '<link rel="modulepreload" href="/static/quick-start.js" crossorigin />'
    );
    expect(out.match(/rel="modulepreload"/g)?.length).toBe(2);
  });

  it('picks the most specific pattern when several match (literal over param)', () => {
    const map = {
      '/docs/:slug': ['/static/generic.js'],
      '/docs/quick-start': ['/static/specific.js'],
    };
    const out = routePreloadTags(map, '/docs/quick-start');
    expect(out).toContain('/static/specific.js');
    expect(out).not.toContain('/static/generic.js');
  });

  it('matches a parameterized pattern for a concrete URL', () => {
    const map = { '/demo/projects/:projectId': ['/static/project.js'] };
    const out = routePreloadTags(map, '/demo/projects/42');
    expect(out).toContain('/static/project.js');
  });
});
