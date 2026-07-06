// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/preact';
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

  it('transitions list to detail view on card click and back', () => {
    stubMatchMedia(false);
    const { container } = render(<ChapterTransitions />);

    // Initially list is shown
    expect(container.querySelector('.hx-vt__card')).toBeTruthy();

    // Click first card to enter detail view
    const firstCard = container.querySelector('.hx-vt__card') as HTMLElement;
    fireEvent.click(firstCard);

    // Detail view should appear
    expect(screen.getByText('Back to projects')).toBeTruthy();
    expect(container.querySelector('.hx-vt__detail')).toBeTruthy();

    // Click "Back to projects" to return to list
    const backButton = screen.getByText('Back to projects') as HTMLElement;
    fireEvent.click(backButton);

    // List should be shown again
    expect(container.querySelector('.hx-vt__card')).toBeTruthy();
    expect(container.querySelector('.hx-vt__detail')).toBeFalsy();
  });
});
