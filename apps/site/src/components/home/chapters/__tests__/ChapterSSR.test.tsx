// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { ChapterSSR } from '../ChapterSSR.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChapterSSR', () => {
  it('renders the heading, the true-claim copy, and the A/B devices', () => {
    render(<ChapterSSR />);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('SSR, no client waterfall.');

    // A >= 6-word contiguous substring of the true desc copy.
    expect(
      screen.getByText(
        /The client never staircases through per-component fetches/
      )
    ).toBeInTheDocument();

    // Device chapter: an A/B of two comparison panels, each with a browser
    // preview and a network Wire. `.hx-panel` is this chapter's own wrapper
    // class (added to home.css, guaranteed to render); the address URL and a
    // lane label are strings fed into the kit primitives, so these checks are
    // kit-namespace-agnostic and independent of scroll progress.
    expect(document.querySelectorAll('.hx-panel')).toHaveLength(2);
    expect(screen.getAllByText(/example\.app \/ projects/)).toHaveLength(2);
    expect(screen.getByText(/hydrate\.js/)).toBeInTheDocument();
  });

  it('keeps the static frame (heading + copy) under prefers-reduced-motion', () => {
    // reduce=true makes ScrollStage render its static fallback frame with no
    // scroll listeners; the scene head text must still be server-coherent.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));

    render(<ChapterSSR />);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('SSR, no client waterfall.');
    expect(
      screen.getByText(
        /The client never staircases through per-component fetches/
      )
    ).toBeInTheDocument();
  });
});
