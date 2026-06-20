// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useHashScroll } from '../use-hash-scroll.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

function Harness({ path }: { path: string }) {
  useHashScroll(path);
  return null;
}

describe('useHashScroll', () => {
  it('scrolls the hash target into view on path change', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const target = document.createElement('h2');
    target.id = 'options';
    document.body.appendChild(target);
    const spy = vi.fn();
    target.scrollIntoView = spy;
    window.location.hash = '#options';

    render(<Harness path="/docs/loaders" />);
    expect(spy).toHaveBeenCalled();
    target.remove();
  });

  it('does nothing without a hash', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    expect(() => render(<Harness path="/docs/loaders" />)).not.toThrow();
  });
});
