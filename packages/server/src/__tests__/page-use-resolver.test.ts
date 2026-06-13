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
