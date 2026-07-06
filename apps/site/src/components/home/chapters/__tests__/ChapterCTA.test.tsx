// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { ChapterCTA } from '../ChapterCTA.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterCTA', () => {
  it('renders the heading, a chunk of the true copy, and both CTA links', () => {
    const { getByRole, container } = render(<ChapterCTA />);

    // Heading is the exact chapter title, rendered as the hx-scene__title h2.
    const heading = getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Build something that feels alive.');

    // A contiguous 11-word substring of the real desc copy is present.
    expect(container.textContent).toContain(
      'Start with the quick start, or poke at the live demo.'
    );

    // Both actions render with the real hrefs (calm centered section).
    const start = getByRole('link', {
      name: 'Get started',
    }) as HTMLAnchorElement;
    const demo = getByRole('link', {
      name: 'See the demo',
    }) as HTMLAnchorElement;
    expect(start.getAttribute('href')).toBe('/docs/quick-start');
    expect(demo.getAttribute('href')).toBe('/demo');

    // Speculation Rules dogfood note is present.
    expect(container.textContent).toMatch(/Speculation Rules/i);
  });

  it('still renders heading + copy under prefers-reduced-motion (static fallback frame)', () => {
    // Stub matchMedia so the reduce query matches; Reveal renders instantly.
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList
    );

    const { getByRole, container } = render(<ChapterCTA />);
    expect(getByRole('heading', { level: 2 }).textContent).toBe(
      'Build something that feels alive.'
    );
    expect(container.textContent).toContain(
      'Start with the quick start, or poke at the live demo.'
    );
  });
});
