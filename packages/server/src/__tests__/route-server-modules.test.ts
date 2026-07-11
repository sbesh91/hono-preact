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
});
