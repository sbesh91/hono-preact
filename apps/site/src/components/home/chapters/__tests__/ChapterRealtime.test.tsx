// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { ChapterRealtime } from '../ChapterRealtime.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterRealtime (Live, both ways)', () => {
  it('renders the heading, a copy substring, and a device surface', () => {
    const { container, getByRole, getByText } = render(<ChapterRealtime />);

    expect(
      getByRole('heading', { name: /live, both ways/i })
    ).toBeInTheDocument();

    expect(
      getByText(/reach for a WebSocket when the browser must talk back/i)
    ).toBeInTheDocument();

    // Device chapter: a live device surface must render. `.hx-rt-room` is this
    // chapter's own live-room surface (rendered inside the BrowserFrame), so the
    // assertion holds on markup this task owns; `.hx-browser` is the kit frame.
    expect(container.querySelector('.hx-browser, .hx-rt-room')).not.toBeNull();
  });

  it('still renders the heading and copy with reduced motion (static frame)', () => {
    // usePrefersReducedMotion reads matchMedia('(prefers-reduced-motion: reduce)').
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));

    const { getByRole, getByText } = render(<ChapterRealtime />);

    expect(
      getByRole('heading', { name: /live, both ways/i })
    ).toBeInTheDocument();

    expect(
      getByText(/reach for a WebSocket when the browser must talk back/i)
    ).toBeInTheDocument();
  });
});
