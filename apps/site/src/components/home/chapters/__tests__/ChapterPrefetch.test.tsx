// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ChapterPrefetch } from '../ChapterPrefetch.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterPrefetch', () => {
  it('renders the heading, the true-claim copy, and the browser device', () => {
    const { container, getByRole } = render(<ChapterPrefetch />);

    expect(
      getByRole('heading', { level: 2, name: 'Instant navigation.' })
    ).toBeTruthy();

    const text = container.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain(
      'hands whole-page link prefetch to the browser-native'
    );

    // Device chapter: the BrowserFrame (or a lane) must be present.
    expect(container.querySelector('.hx-browser, .hx-lane')).toBeTruthy();
  });

  it('still renders the heading and copy with reduced motion (static frame)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
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

    const { container, getByRole } = render(<ChapterPrefetch />);

    expect(
      getByRole('heading', { level: 2, name: 'Instant navigation.' })
    ).toBeTruthy();

    const text = container.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain(
      'hands whole-page link prefetch to the browser-native'
    );
  });
});
