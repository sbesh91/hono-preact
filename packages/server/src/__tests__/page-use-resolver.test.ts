import { describe, it, expect } from 'vitest';
import { makePageUseResolver } from '../route-server-modules.js';

const a = { __kind: 'middleware', runs: 'server', fn: async () => {} } as const;
const b = { __kind: 'middleware', runs: 'server', fn: async () => {} } as const;

// Minimal manifest stub: the resolver only reads `routeUse`.
const manifest = {
  routeUse: [
    { path: '/demo/projects', use: [a] },
    { path: '/demo/projects/:projectId', use: [a, b] },
    { path: '/demo/login', use: [] },
  ],
} as never;

describe('makePageUseResolver.byPattern (exact-key lookup)', () => {
  it('resolves a route PATTERN to its own use via exact key match', () => {
    const r = makePageUseResolver(manifest);
    expect(r.byPattern('/demo/projects')).toEqual([a]);
    expect(r.byPattern('/demo/projects/:projectId')).toEqual([a, b]);
    expect(r.byPattern('/demo/login')).toEqual([]);
  });

  it('returns [] for a pattern with no exact entry', () => {
    const r = makePageUseResolver(manifest);
    // A concrete URL is not an exact pattern key, so it does NOT match here:
    // the resolver only ever takes a declared route pattern, never a URL.
    expect(r.byPattern('/demo/projects/42')).toEqual([]);
    expect(r.byPattern('/nope')).toEqual([]);
  });

  it('resolves sibling same-shaped patterns to their OWN use (no fuzzy collision)', () => {
    // Two registered patterns with identical segment shape at the same depth.
    // Exact-key lookup gives each its own guards; a URL fuzzy-matcher would have
    // collided them and returned the wrong page's guards (the removed byPath
    // hazard the loaders/sockets/actions paths all now avoid).
    const siblings = {
      routeUse: [
        { path: '/items/:a', use: [a] },
        { path: '/items/:b', use: [b] },
      ],
    } as never;
    const r = makePageUseResolver(siblings);
    expect(r.byPattern('/items/:a')).toEqual([a]);
    expect(r.byPattern('/items/:b')).toEqual([b]);
  });
});
