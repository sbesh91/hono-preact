import { describe, it, expect } from 'vitest';
import {
  selectRoutePreload,
  type RoutePreloadMap,
} from '../route-preload-match.js';

const MAP: RoutePreloadMap = {
  '/': ['/static/home-AAAA.js'],
  '/docs/:slug': ['/static/DocsLayout-BBBB.js', '/static/slug-CCCC.js'],
  '/docs/quick-start': [
    '/static/DocsLayout-BBBB.js',
    '/static/quick-start-DDDD.js',
  ],
};

describe('selectRoutePreload', () => {
  it('matches an exact literal route', () => {
    expect(selectRoutePreload(MAP, '/')).toEqual(['/static/home-AAAA.js']);
  });

  it('prefers the more specific literal over a param pattern', () => {
    // Both /docs/:slug and /docs/quick-start match; the literal wins.
    expect(selectRoutePreload(MAP, '/docs/quick-start')).toEqual([
      '/static/DocsLayout-BBBB.js',
      '/static/quick-start-DDDD.js',
    ]);
  });

  it('falls back to the param pattern for an unlisted slug', () => {
    expect(selectRoutePreload(MAP, '/docs/anything-else')).toEqual([
      '/static/DocsLayout-BBBB.js',
      '/static/slug-CCCC.js',
    ]);
  });

  it('prefers the exact root `/` over a catch-all `*` (which both score 0)', () => {
    const withCatchAll: RoutePreloadMap = {
      '/': ['/static/home-AAAA.js'],
      '*': ['/static/not-found-ZZZZ.js'],
    };
    expect(selectRoutePreload(withCatchAll, '/')).toEqual([
      '/static/home-AAAA.js',
    ]);
    // A truly unmatched path still falls through to the catch-all.
    expect(selectRoutePreload(withCatchAll, '/missing')).toEqual([
      '/static/not-found-ZZZZ.js',
    ]);
  });

  it('returns undefined on no match, no map, or an empty chunk list', () => {
    expect(selectRoutePreload(MAP, '/nope')).toBeUndefined();
    expect(selectRoutePreload(undefined, '/')).toBeUndefined();
    expect(selectRoutePreload({}, '/')).toBeUndefined();
    expect(selectRoutePreload({ '/x': [] }, '/x')).toBeUndefined();
  });
});
