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

  describe('reserved param-name rejection (structural prototype-chain fix)', () => {
    // serverRoute rejects a route whose pattern DECLARES a param named after an
    // Object.prototype member, the same check defineRoutes runs on the route
    // tree. A registered route with such a param is already rejected there, but
    // a serverRoute-bound loader/action/socket/room can name its own pattern
    // directly, so this closes the prototype-chain param-read hazard on that
    // surface too. With no route-bound unit able to declare a reserved param
    // name, the params objects a guard sees stay ordinary objects (no null
    // prototype needed anywhere).
    it('throws for a reserved param name', () => {
      expect(() => serverRoute('/plugin/:constructor')).toThrow(/reserved/);
      expect(() => serverRoute('/plugin/:toString')).toThrow(/reserved/);
      expect(() => serverRoute('/plugin/:hasOwnProperty')).toThrow(/reserved/);
      expect(() => serverRoute('/x/:__proto__')).toThrow(/reserved/);
    });

    it('names the offending param in the error', () => {
      expect(() => serverRoute('/plugin/:valueOf')).toThrow(/:valueOf/);
    });

    it('does not throw for an ordinary param name', () => {
      expect(() => serverRoute('/things/:id')).not.toThrow();
      expect(() => serverRoute('/org/:orgId/board/:boardId')).not.toThrow();
      // toJSON/prototype are NOT Object.prototype members, so they are allowed.
      expect(() => serverRoute('/x/:toJSON')).not.toThrow();
    });
  });
});
