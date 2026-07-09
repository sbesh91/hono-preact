// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { ChapterEdge } from '../ChapterEdge.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterEdge (runs on the platform)', () => {
  it('renders the heading, the pitch, and the typed-surface chips', () => {
    render(<ChapterEdge />);

    // Chapter heading is an h2.
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /runs on the platform, at the edge/i,
      })
    ).toBeInTheDocument();

    // A >=6-word substring unique to the desc paragraph (no single card
    // repeats it).
    expect(
      screen.getByText(
        /it renders on the server and serves realtime the same way/i
      )
    ).toBeInTheDocument();

    // One of the three Reveal cards.
    expect(
      screen.getByRole('heading', { level: 3, name: /typed edge to browser/i })
    ).toBeInTheDocument();

    // The typed-surface chips render in that card (mirrors the other two cards).
    expect(screen.getByText('Loaders')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Params')).toBeInTheDocument();
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
      screen.getByText(
        /it renders on the server and serves realtime the same way/i
      )
    ).toBeInTheDocument();
    // Reveal-wrapped content is present too: proves the static frame renders
    // its children under reduced motion, not just the head outside Reveal.
    expect(
      screen.getByRole('heading', { level: 3, name: /typed edge to browser/i })
    ).toBeInTheDocument();
  });
});
