// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useTypeahead } from '../use-typeahead.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

let api: { onChar: (c: string) => string } | null = null;
function Harness({ idleMs }: { idleMs?: number }) {
  const fn = useTypeahead({ idleMs });
  const ref = useRef(fn);
  ref.current = fn;
  api = { onChar: (c) => ref.current(c) };
  return null;
}

describe('useTypeahead', () => {
  it('accumulates characters within the idle window', () => {
    render(<Harness idleMs={500} />);
    expect(api!.onChar('p')).toBe('p');
    expect(api!.onChar('a')).toBe('pa');
    expect(api!.onChar('s')).toBe('pas');
  });

  it('resets the buffer after the idle gap', () => {
    render(<Harness idleMs={500} />);
    expect(api!.onChar('p')).toBe('p');
    vi.advanceTimersByTime(500);
    expect(api!.onChar('c')).toBe('c');
  });
});
