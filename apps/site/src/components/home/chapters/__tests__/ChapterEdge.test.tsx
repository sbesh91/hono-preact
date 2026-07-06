// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { ChapterEdge } from '../ChapterEdge.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterEdge (runs on the platform)', () => {
  it('renders the heading, the pitch, and the adapter code sample', () => {
    const { container } = render(<ChapterEdge />);

    // Chapter heading is an h2.
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /runs on the platform, at the edge/i,
      })
    ).toBeInTheDocument();

    // A >=6-word substring of the desc that spans both clauses, so it is
    // unique to the full desc paragraph (no single card repeats it).
    expect(
      screen.getByText(/Node; you pick the runtime with a one-line adapter/i)
    ).toBeInTheDocument();

    // One of the three Reveal cards.
    expect(
      screen.getByRole('heading', { level: 3, name: /one-line adapter swap/i })
    ).toBeInTheDocument();

    // The real snippet renders in a <pre> code sample.
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('cloudflareAdapter()');
    expect(pre!.textContent).toContain('nodeAdapter()');
  });

  it('still renders the heading, pitch, and Reveal cards with reduced motion', () => {
    // Stub prefers-reduced-motion: reduce so Reveal keeps a static frame.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    render(<ChapterEdge />);

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /runs on the platform, at the edge/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Node; you pick the runtime with a one-line adapter/i)
    ).toBeInTheDocument();
    // Reveal-wrapped content is present too: proves the static frame renders
    // its children under reduced motion, not just the head outside Reveal.
    expect(
      screen.getByRole('heading', { level: 3, name: /one-line adapter swap/i })
    ).toBeInTheDocument();
  });
});
