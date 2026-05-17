import { describe, it, expect } from 'vitest';
import { defineRoutes } from '@hono-preact/iso';
import { routeServerModules } from '../route-server-modules.js';

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
