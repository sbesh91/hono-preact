import { describe, it, expect } from 'vitest';
import { defineRoutes } from '@hono-preact/iso';
import { routeServerModules } from '../route-server-modules.js';

describe('routeServerModules', () => {
  it('returns a LazyGlob-shaped record indexed by integer keys', async () => {
    const sA = () => Promise.resolve({ tag: 'A' });
    const sB = () => Promise.resolve({ tag: 'B' });
    const m = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: () => null }), server: sA },
      { path: '/x', view: () => Promise.resolve({ default: () => null }), server: sB },
    ]);
    const glob = routeServerModules(m);
    const keys = Object.keys(glob).sort();
    expect(keys).toEqual(['0', '1']);
    const values = await Promise.all(Object.values(glob).map((fn) => fn()));
    const tags = values.map((v) => (v as { tag: string }).tag).sort();
    expect(tags).toEqual(['A', 'B']);
  });

  it('returns an empty record when no server imports exist', () => {
    const m = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: () => null }) },
    ]);
    expect(routeServerModules(m)).toEqual({});
  });
});
