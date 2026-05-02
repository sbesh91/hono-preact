// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { lazy } from '../lazy.js';

describe('lazy() wrapper', () => {
  it('returns a component with preload() that resolves to the module', async () => {
    const Mod = { default: () => null, marker: 'movies-mod' };
    const Lazy = lazy(async () => Mod);
    const m = await Lazy.preload();
    expect(m).toBe(Mod);
  });

  it('returns null from getResolvedDefault before preload', () => {
    const Lazy = lazy(async () => ({ default: () => null }));
    expect(Lazy.getResolvedDefault()).toBeNull();
  });

  it('returns the resolved default after preload completes', async () => {
    const Inner = () => null;
    const Lazy = lazy(async () => ({ default: Inner }));
    await Lazy.preload();
    expect(Lazy.getResolvedDefault()).toBe(Inner);
  });

  it('also handles modules whose export is the component itself (no default key)', async () => {
    // preact-iso's lazy supports `m.default || m` — preserve that behavior.
    const Inner = () => null;
    const Lazy = lazy(async () => Inner as unknown as { default: typeof Inner });
    await Lazy.preload();
    expect(Lazy.getResolvedDefault()).toBe(Inner);
  });

  it('preload() returns the same promise on repeated calls', () => {
    const Lazy = lazy(async () => ({ default: () => null }));
    const p1 = Lazy.preload();
    const p2 = Lazy.preload();
    expect(p1).toBe(p2);
  });
});
