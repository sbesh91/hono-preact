// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/preact';
import { usePrefersReducedMotion, useIsNarrow } from '../motion.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe('usePrefersReducedMotion', () => {
  it('reflects a reduce preference after mount', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });
  it('is false when no reduce preference', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});

describe('useIsNarrow', () => {
  it('is true when the narrow query matches', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsNarrow(48));
    expect(result.current).toBe(true);
  });
});
