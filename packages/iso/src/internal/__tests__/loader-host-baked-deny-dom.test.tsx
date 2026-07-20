// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { defineLoader } from '../../define-loader.js';
import { env } from '../../is-browser.js';
import { getPreloadedDeny } from '../preload.js';

// Drive the REAL `LoaderHost` coldError branch (via `.View`) rather than
// asserting at the runner level, so the wrap this task adds actually runs.
// The seeding technique mirrors `loader.test.tsx`'s established convention:
// mock `../preload.js` and control `getPreloadedDeny`'s return directly,
// rather than seeding a real DOM element by id.
//
// A DOM-seeded id has two problems here: (1) `useId()` is not stable across
// separate `render()` calls, so discovering the id via a mount-then-remount
// cycle is fragile (see `loader-runner-baked-deny.test.tsx`); and (2) even
// with a fixed id, `use-loader-runner.tsx`'s OWN cleanup effect
// (`deletePreloadedDeny`) consumes-and-clears the `data-loader-deny` DOM
// marker synchronously within the same mount (exactly like it does for
// `data-loader`), so a real seeded attribute would already be stripped by
// the time `render()` returns and effects have flushed. Mocking
// `getPreloadedDeny` sidesteps both: the runner reads a controlled value,
// and `deletePreloadedDeny` is a no-op spy so nothing depends on DOM timing.
vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => ({ present: false })),
  deletePreloadedData: vi.fn(),
  getPreloadedDeny: vi.fn(() => ({ present: false })),
  deletePreloadedDeny: vi.fn(),
}));

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
});
afterEach(() => {
  env.current = originalEnv;
  cleanup();
  vi.clearAllMocks();
});

describe('LoaderHost client coldError re-wrap (hydration parity for a baked deny)', () => {
  it('wraps the fallback in a data-loader-deny Envelope when the coldError is seeded from an SSR-baked deny marker', () => {
    vi.mocked(getPreloadedDeny).mockReturnValueOnce({
      present: true,
      message: 'gone',
    });
    const fn = vi.fn(() => Promise.resolve({ ok: true }));
    const ref = defineLoader<{ ok: boolean }>(fn);
    const View = ref.View(() => <div>ok</div>, {
      errorFallback: (e: Error) => <p class="fb">{e.message}</p>,
    });

    const { container } = render(<View />);

    // The client DOM must carry the SAME `data-loader-deny` wrapper the
    // server emitted (Task 6), so hydration matches and no mismatch/refetch
    // occurs.
    const wrapper = container.querySelector('[data-loader-deny]');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.querySelector('.fb')?.textContent).toBe('gone');
    // Baked deny short-circuits the loader entirely: no client fetch.
    expect(fn).not.toHaveBeenCalled();
  });

  it('regression: a pure client-nav coldError (a real failed fetch, no baked marker) renders the fallback bare, with NO data-loader-deny wrapper', async () => {
    // Default mock: getPreloadedDeny returns { present: false } (no seed).
    const fn = vi.fn(() => Promise.reject(new Error('boom')));
    const ref = defineLoader<{ ok: boolean }>(fn);
    const View = ref.View(() => <div>ok</div>, {
      errorFallback: (e: Error) => <p class="fb">{e.message}</p>,
    });

    const { container } = render(<View />);

    await waitFor(() =>
      expect(container.querySelector('.fb')?.textContent).toBe('boom')
    );
    expect(container.querySelector('[data-loader-deny]')).toBeNull();
  });
});
