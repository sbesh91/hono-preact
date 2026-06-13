import { describe, it, expect } from 'vitest';
import { defineLoader, type LoaderCtx } from '../define-loader.js';

describe('defineLoader(routeId, fn) overload', () => {
  it('returns a LoaderRef behaviorally identical to defineLoader(fn)', () => {
    const fn = async (_ctx: LoaderCtx<{ id: string }>) => ({ ok: true });
    const ref = defineLoader('/things/:id', fn);
    expect(typeof ref.__id).toBe('symbol');
    expect(ref.fn).toBe(fn);
    expect(ref.params).toEqual([]);
    expect(typeof ref.invalidate).toBe('function');
  });

  it('threads opts through the third argument', () => {
    const fn = async (_ctx: LoaderCtx<{ id: string }>) => ({ ok: true });
    const ref = defineLoader('/things/:id', fn, { params: ['q'] });
    expect(ref.params).toEqual(['q']);
  });

  it('still supports the fn-first form', () => {
    const fn = async () => ({ ok: true });
    const ref = defineLoader(fn, { params: '*' });
    expect(ref.fn).toBe(fn);
    expect(ref.params).toBe('*');
  });
});
