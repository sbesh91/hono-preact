import { describe, it, expect } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineLoader, type LoaderCtx } from '../define-loader.js';

describe('serverRoute', () => {
  it('loader() returns a LoaderRef behaviorally identical to defineLoader(routeId, fn)', () => {
    const route = serverRoute('/things/:id');
    const fn = async (_ctx: LoaderCtx<{ id: string }>) => ({ ok: true });
    const viaFactory = route.loader(fn);
    const viaDirect = defineLoader('/things/:id', fn);

    expect(typeof viaFactory.__id).toBe('symbol');
    expect(viaFactory.fn).toBe(fn);
    expect(viaFactory.params).toEqual(viaDirect.params);
    expect(typeof viaFactory.invalidate).toBe('function');
  });

  it('forwards opts through to defineLoader', () => {
    const route = serverRoute('/things/:id');
    const ref = route.loader(
      async (_ctx: LoaderCtx<{ id: string }>) => ({ ok: true }),
      { params: ['q'] }
    );
    expect(ref.params).toEqual(['q']);
  });
});
