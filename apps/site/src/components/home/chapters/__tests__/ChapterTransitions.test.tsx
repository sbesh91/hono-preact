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

  it('renders the animated morph demo and the ideas list', () => {
    const { container } = render(<ChapterTransitions />);

    // A single browser frame hosts the shared-element morph.
    expect(container.querySelectorAll('.hx-browser').length).toBe(1);
    expect(container.querySelector('.hx-morph')).toBeTruthy();

    // The three ideas annotations are present.
    expect(container.querySelectorAll('.hx-why__item').length).toBe(3);

    // And a link out to the real demo.
    expect(screen.getByText('Feel the real thing in the demo')).toBeTruthy();
  });
});
