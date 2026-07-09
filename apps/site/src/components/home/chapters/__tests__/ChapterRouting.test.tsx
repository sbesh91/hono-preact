// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { ChapterRouting } from '../ChapterRouting.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterRouting (Routing is a manifest)', () => {
  it('renders the heading, the claim copy, the browser device, and the nested route layers', () => {
    const { container } = render(<ChapterRouting />);

    // Heading.
    expect(
      screen.getByRole('heading', { level: 2, name: /routing is a manifest/i })
    ).toBeInTheDocument();

    // A >=6-word substring of the true-claim desc copy.
    expect(
      screen.getByText(/nested layouts stay mounted while their child swaps/i)
    ).toBeInTheDocument();

    // Device: BrowserFrame renders the .hx-browser shell.
    expect(container.querySelector('.hx-browser')).not.toBeNull();

    // The nested-layout stack renders at least the mounted root layer, which is
    // the "routes are a manifest, not a folder tree" visualization.
    expect(container.querySelector('.hx-route__layer')).not.toBeNull();
    expect(screen.getByText('Root layout')).toBeInTheDocument();

    // The real code snippet renders in a <pre>.
    expect(container.querySelector('pre')?.textContent).toMatch(
      /defineRoutes\(\[/
    );
  });

  it('still renders the heading and claim copy with reduced motion (static fallback frame)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    render(<ChapterRouting />);

    expect(
      screen.getByRole('heading', { level: 2, name: /routing is a manifest/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nested layouts stay mounted while their child swaps/i)
    ).toBeInTheDocument();
  });
});
