import { describe, it, expect } from 'vitest';
import { defineRoutes } from '@hono-preact/iso';
import {
  routeServerModules,
  makeGuardedRouteMatcher,
} from '../route-server-modules.js';

describe('routeServerModules', () => {
  it('returns an array of lazy server-module loaders preserving manifest order', async () => {
    const sA = () => Promise.resolve({ tag: 'A' });
    const sB = () => Promise.resolve({ tag: 'B' });
    const m = defineRoutes([
      {
        path: '/',
        view: () => Promise.resolve({ default: () => null }),
        server: sA,
      },
      {
        path: '/x',
        view: () => Promise.resolve({ default: () => null }),
        server: sB,
      },
    ]);
    const arr = routeServerModules(m);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(2);
    const tags = (await Promise.all(arr.map((fn) => fn()))).map(
      (v) => (v as { tag: string }).tag
    );
    expect(tags).toEqual(['A', 'B']);
  });

  it('returns an empty array when no server imports exist', () => {
    const m = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: () => null }) },
    ]);
    expect(routeServerModules(m)).toEqual([]);
  });
});

describe('makeGuardedRouteMatcher', () => {
  const guard = { marker: 'guard' };

  it('returns the matched pattern when the best match carries use', () => {
    const match = makeGuardedRouteMatcher([
      { path: '/admin/:section', use: [guard] },
      { path: '/public', use: [] },
    ]);
    expect(match('/admin/settings')).toBe('/admin/:section');
  });

  it('returns null when the best match carries no use', () => {
    // '/admin/health' (all literal segments) outranks '/admin/:rest*'. Its
    // folded use is empty, so the URL is not considered guarded even though
    // a broader guarded pattern also matches. routeUse entries already fold
    // ancestor use, so a genuinely gated child never has an empty entry.
    const match = makeGuardedRouteMatcher([
      { path: '/admin/:rest*', use: [guard] },
      { path: '/admin/health', use: [] },
    ]);
    expect(match('/admin/health')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    const match = makeGuardedRouteMatcher([{ path: '/a', use: [guard] }]);
    expect(match('/b/c')).toBeNull();
  });

  it('ignores an empty-use subtree sibling so the guarded exact key still matches', () => {
    // '/app/*' is a binder-scope key (empty chain: the layout node and all
    // ancestors are unguarded); only the index child's own use guards '/app'.
    // The deeper subtree key must not outrank the guarded exact key and
    // suppress the bare-loader warning for '/app'.
    const match = makeGuardedRouteMatcher([
      { path: '/app', use: [guard] },
      { path: '/app/*', use: [] },
    ]);
    expect(match('/app')).toBe('/app');
  });

  it('suggests the subtree pattern for a layout-location request', () => {
    const gate = () => {};
    const match = makeGuardedRouteMatcher([
      { path: '/demo/projects', use: [gate] },
      { path: '/demo/projects/*', use: [gate] },
      { path: '/demo/projects/:projectId', use: [gate] },
    ]);
    // Equal literal score for the exact and wildcard keys; the deeper
    // wildcard wins, so the #263 warning names the subtree spelling for a
    // layout-location request.
    expect(match('/demo/projects')).toBe('/demo/projects/*');
    // A leaf request still resolves its more specific param pattern.
    expect(match('/demo/projects/p1')).toBe('/demo/projects/:projectId');
  });
});
