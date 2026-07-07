import { describe, it, expect } from 'vitest';
import {
  selectRoutePreload,
  renderRoutePreloadTags,
  type RoutePreloadMap,
} from '../route-preload-tags.js';

const tagsFor = (map: RoutePreloadMap | undefined, path: string) =>
  renderRoutePreloadTags(selectRoutePreload(map, path));

const MAP: RoutePreloadMap = {
  '/': { high: [], low: ['/static/home-AAAA.js'] },
  '/docs/:slug': {
    high: ['/static/DocsLayout-BBBB.js'],
    low: ['/static/slug-CCCC.js'],
  },
  '/docs/quick-start': {
    high: ['/static/DocsLayout-BBBB.js'],
    low: ['/static/quick-start-DDDD.js'],
  },
};

describe('selectRoutePreload', () => {
  it('matches an exact literal route', () => {
    expect(selectRoutePreload(MAP, '/')).toEqual({
      high: [],
      low: ['/static/home-AAAA.js'],
    });
  });

  it('prefers the more specific literal over a param pattern', () => {
    // Both /docs/:slug and /docs/quick-start match; the literal wins.
    expect(selectRoutePreload(MAP, '/docs/quick-start')).toEqual({
      high: ['/static/DocsLayout-BBBB.js'],
      low: ['/static/quick-start-DDDD.js'],
    });
  });

  it('falls back to the param pattern for an unlisted slug', () => {
    expect(selectRoutePreload(MAP, '/docs/anything-else')).toEqual({
      high: ['/static/DocsLayout-BBBB.js'],
      low: ['/static/slug-CCCC.js'],
    });
  });

  it('prefers the exact root `/` over a catch-all `*` (which both score 0)', () => {
    const withCatchAll: RoutePreloadMap = {
      '/': { high: [], low: ['/static/home-AAAA.js'] },
      '*': { high: [], low: ['/static/not-found-ZZZZ.js'] },
    };
    expect(selectRoutePreload(withCatchAll, '/')).toEqual({
      high: [],
      low: ['/static/home-AAAA.js'],
    });
    // A truly unmatched path still falls through to the catch-all.
    expect(selectRoutePreload(withCatchAll, '/missing')).toEqual({
      high: [],
      low: ['/static/not-found-ZZZZ.js'],
    });
  });

  it('returns undefined on no match or no map', () => {
    expect(selectRoutePreload(MAP, '/nope')).toBeUndefined();
    expect(selectRoutePreload(undefined, '/')).toBeUndefined();
    expect(selectRoutePreload({}, '/')).toBeUndefined();
  });
});

describe('renderRoutePreloadTags', () => {
  it('emits high chunks at default priority and low chunks with fetchpriority=low', () => {
    const tags = tagsFor(MAP, '/docs/quick-start');
    expect(tags).toContain(
      '<link rel="modulepreload" href="/static/DocsLayout-BBBB.js" />'
    );
    expect(tags).toContain(
      '<link rel="modulepreload" href="/static/quick-start-DDDD.js" fetchpriority="low" />'
    );
  });

  it('omits crossorigin, matching the entry script and closure hints', () => {
    expect(tagsFor(MAP, '/docs/quick-start')).not.toContain('crossorigin');
  });

  it('returns "" when there is no match, no map, or no chunks', () => {
    expect(tagsFor(MAP, '/nope')).toBe('');
    expect(tagsFor(undefined, '/')).toBe('');
    expect(tagsFor({ '/x': { high: [], low: [] } }, '/x')).toBe('');
  });

  it('escapes reserved characters in hrefs', () => {
    const tags = tagsFor({ '/': { high: [], low: ['/static/a"b&c.js'] } }, '/');
    expect(tags).toContain('href="/static/a&quot;b&amp;c.js"');
  });
});
