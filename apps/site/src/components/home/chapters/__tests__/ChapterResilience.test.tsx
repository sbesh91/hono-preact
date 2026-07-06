// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { ChapterResilience } from '../ChapterResilience.js';

// The kit's reduced-motion / narrow hooks call matchMedia during render; happy-dom
// needs a deterministic stub. reduce=true reports the reduced-motion query as matched.
function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce ? query.includes('reduce') : false,
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
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterResilience', () => {
  it('renders the heading, the claim copy, and the resilient demo device', () => {
    stubMatchMedia(false);
    const { container } = render(<ChapterResilience />);

    const heading = container.querySelector('.hx-scene__title');
    expect(heading?.textContent).toContain('Built to degrade, not crash');

    const desc = (
      container.querySelector('.hx-scene__desc')?.textContent ?? ''
    ).replace(/\s+/g, ' ');
    expect(desc).toContain(
      'stale-while-revalidate and keep-last-good-value are the default'
    );

    // Device structure: the demo app inside the BrowserFrame renders its own
    // markup (.hx-res root + three panes), so assert on that rather than on the
    // kit's internal frame/lane class names.
    const device = container.querySelector('.hx-res');
    expect(device).not.toBeNull();
    expect(container.querySelectorAll('.hx-res__pane')).toHaveLength(3);
  });

  it('still renders heading, copy, and the static demo device with reduced motion', () => {
    stubMatchMedia(true);
    const { container } = render(<ChapterResilience />);

    const heading = container.querySelector('.hx-scene__title');
    expect(heading?.textContent).toContain('Built to degrade, not crash');

    const desc = (
      container.querySelector('.hx-scene__desc')?.textContent ?? ''
    ).replace(/\s+/g, ' ');
    expect(desc).toContain(
      'stale-while-revalidate and keep-last-good-value are the default'
    );

    // The kit keeps a static fallback frame under reduced motion, so the demo
    // device and its panes must still be present.
    const device = container.querySelector('.hx-res');
    expect(device).not.toBeNull();
    expect(container.querySelectorAll('.hx-res__pane')).toHaveLength(3);
  });
});
