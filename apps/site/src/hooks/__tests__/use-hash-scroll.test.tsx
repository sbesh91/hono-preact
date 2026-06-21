// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
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
  it('scrolls a present hash target into view on mount', () => {
    const target = document.createElement('h2');
    target.id = 'options';
    const spy = vi.fn();
    target.scrollIntoView = spy;
    document.body.appendChild(target);
    window.location.hash = '#options';

    render(<Harness path="/docs/loaders" />);
    expect(spy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    target.remove();
  });

  it('does nothing without a hash', () => {
    expect(() => render(<Harness path="/docs/loaders" />)).not.toThrow();
  });

  it('waits for a cold-loaded target to mount, then scrolls once', async () => {
    window.location.hash = '#late';
    render(<Harness path="/docs/loaders" />); // target absent: observe and wait

    const target = document.createElement('h2');
    target.id = 'late';
    const spy = vi.fn();
    target.scrollIntoView = spy;
    document.body.appendChild(target); // a DOM mutation the observer reacts to

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    );
    target.remove();
  });
});
