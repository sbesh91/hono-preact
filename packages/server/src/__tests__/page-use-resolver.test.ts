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

describe('makePageUseResolver', () => {
  it('returns the composed use for the most specific matching pattern', () => {
    const r = makePageUseResolver(manifest);
    expect(r.byPath('/demo/projects')).toEqual([a]);
    expect(r.byPath('/demo/projects/42')).toEqual([a, b]);
  });
  it('returns [] for an unguarded path and for no match', () => {
    const r = makePageUseResolver(manifest);
    expect(r.byPath('/demo/login')).toEqual([]);
    expect(r.byPath('/nope')).toEqual([]);
  });
});

describe('makePageUseResolver.byPattern (exact-key lookup)', () => {
  it('resolves a route PATTERN to its own use via exact key match', () => {
    const r = makePageUseResolver(manifest);
    expect(r.byPattern('/demo/projects/:projectId')).toEqual([a, b]);
    expect(r.byPattern('/demo/login')).toEqual([]);
  });

  it('returns [] for a pattern with no exact entry', () => {
    const r = makePageUseResolver(manifest);
    // A concrete URL is not an exact pattern key, so it does NOT match here
    // (that is what byPath is for).
    expect(r.byPattern('/demo/projects/42')).toEqual([]);
    expect(r.byPattern('/nope')).toEqual([]);
  });

  it('does NOT collide sibling same-shaped patterns the way byPath can', () => {
    // Two registered patterns with identical segment shape at the same depth.
    const siblings = {
      routeUse: [
        { path: '/items/:a', use: [a] },
        { path: '/items/:b', use: [b] },
      ],
    } as never;
    const r = makePageUseResolver(siblings);
    // byPath fuzzy-matches a pattern string against both and the tiebreak picks
    // the first in iteration order, so the SECOND sibling resolves to the wrong
    // guards. This is the finding the loaders/sockets RPC paths hit.
    expect(r.byPath('/items/:b')).toEqual([a]); // wrong, demonstrates the hazard
    // byPattern resolves each sibling to its OWN use by exact key.
    expect(r.byPattern('/items/:a')).toEqual([a]);
    expect(r.byPattern('/items/:b')).toEqual([b]);
  });
});
