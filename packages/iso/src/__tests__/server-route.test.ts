import { describe, it, expect } from 'vitest';
import { serverRoute } from '../server-route.js';

describe('serverRoute', () => {
  it('loader() returns a LoaderRef with the correct __routeId', () => {
    const route = serverRoute('/things/:id');
    const fn = async () => ({ ok: true });
    const ref = route.loader(fn);
    expect(typeof ref.__id).toBe('symbol');
    expect(ref.fn).toBe(fn);
    expect(ref.params).toEqual([]);
    expect(ref.__routeId).toBe('/things/:id');
    expect(typeof ref.invalidate).toBe('function');
  });

  it('forwards opts through to the loader ref', () => {
    const route = serverRoute('/things/:id');
    const ref = route.loader(async () => ({ ok: true }), { params: ['q'] });
    expect(ref.params).toEqual(['q']);
    expect(ref.__routeId).toBe('/things/:id');
  });

  it('loader() with a generator fn returns a streaming ref', () => {
    const route = serverRoute('/things/:id');
    async function* gen() {
      yield { ok: true };
    }
    const ref = route.loader(gen);
    expect(ref.fn).toBe(gen);
    expect(ref.__routeId).toBe('/things/:id');
  });
});
