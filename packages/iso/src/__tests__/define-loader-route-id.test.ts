import { describe, it, expect } from 'vitest';
import { defineLoader } from '../define-loader.js';
import { serverRoute } from '../server-route.js';

describe('__routeId assignment', () => {
  it('bare defineLoader gives ref.__routeId === undefined', () => {
    const fn = async () => ({ ok: true });
    const ref = defineLoader(fn);
    expect(ref.__routeId).toBeUndefined();
  });

  it('serverRoute(r).loader gives ref.__routeId === the route', () => {
    const route = serverRoute('/things/:id');
    const fn = async () => ({ ok: true });
    const ref = route.loader(fn);
    expect(ref.__routeId).toBe('/things/:id');
  });

  it('serverRoute(r).loader still forwards opts', () => {
    const route = serverRoute('/things/:id');
    const fn = async () => ({ ok: true });
    const ref = route.loader(fn, { params: ['q'] });
    expect(ref.params).toEqual(['q']);
    expect(ref.__routeId).toBe('/things/:id');
  });

  it('bare defineLoader still supports fn-first form with opts', () => {
    const fn = async () => ({ ok: true });
    const ref = defineLoader(fn, { live: false });
    expect(ref.fn).toBe(fn);
    expect(ref.live).toBe(false);
    expect(ref.__routeId).toBeUndefined();
  });
});
