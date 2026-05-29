import { describe, it, expect, vi } from 'vitest';
import { mergeRefs } from '../internal/merge-refs.js';

describe('mergeRefs', () => {
  it('calls a function ref', () => {
    const fn = vi.fn();
    const merged = mergeRefs(fn);
    const node = {} as Element;
    merged(node);
    expect(fn).toHaveBeenCalledWith(node);
  });

  it('writes to an object ref', () => {
    const ref = { current: null as Element | null };
    const merged = mergeRefs(ref);
    const node = {} as Element;
    merged(node);
    expect(ref.current).toBe(node);
  });

  it('composes multiple refs of mixed shape', () => {
    const fn = vi.fn();
    const ref = { current: null as Element | null };
    const merged = mergeRefs(fn, ref, null, undefined);
    const node = {} as Element;
    merged(node);
    expect(fn).toHaveBeenCalledWith(node);
    expect(ref.current).toBe(node);
  });

  it('passes null on cleanup', () => {
    const fn = vi.fn();
    const ref = { current: null as Element | null };
    const merged = mergeRefs(fn, ref);
    merged({} as Element);
    merged(null);
    expect(fn).toHaveBeenLastCalledWith(null);
    expect(ref.current).toBeNull();
  });
});
