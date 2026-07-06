// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { ChapterTransitions } from '../ChapterTransitions.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Mirrors the matchMedia stub shape used in HeroShader.test.tsx so the kit's
// usePrefersReducedMotion() sees a deterministic reduce value.
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
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

describe('ChapterTransitions', () => {
  it('renders the heading, the true-claim copy, and the browser frame', () => {
    const { container } = render(<ChapterTransitions />);
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /Transitions, for free\./,
      })
    ).toBeTruthy();
    // >= 6-word contiguous substring of the real desc copy.
    expect(
      screen.getByText(
        /wraps every client route change in a view transition automatically/
      )
    ).toBeTruthy();
    // Device chapter: the interactive widget lives inside a BrowserFrame.
    expect(container.querySelector('.hx-browser')).toBeTruthy();
  });

  it('still renders heading and copy with reduced motion (static fallback)', () => {
    stubMatchMedia(true);
    render(<ChapterTransitions />);
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /Transitions, for free\./,
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        /wraps every client route change in a view transition automatically/
      )
    ).toBeTruthy();
  });

  it('renders the faked morph illustration and the ideas list', () => {
    const { container } = render(<ChapterTransitions />);

    // Two browser frames: the list and the detail it morphs into.
    expect(container.querySelectorAll('.hx-browser').length).toBe(2);

    // The shared-element pair (list card + detail hero) both carry the morph
    // treatment, so the reader reads them as one element.
    expect(container.querySelectorAll('.hx-vt2__row--morph').length).toBe(2);

    // The three ideas annotations are present.
    expect(container.querySelectorAll('.hx-why__item').length).toBe(3);

    // And a link out to the real demo.
    expect(screen.getByText('Feel the real thing in the demo')).toBeTruthy();
  });
});
