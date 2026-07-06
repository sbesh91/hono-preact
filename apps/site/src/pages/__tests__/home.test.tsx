// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/preact';
import Home from '../home.js';

afterEach(() => cleanup());

describe('home (scroll experience)', () => {
  it('links to /docs/quick-start as the primary CTA', () => {
    const { container } = render(<Home />);
    const hero = container.querySelector('.hx-hero') as HTMLElement;
    expect(
      within(hero)
        .getByRole('link', { name: /get started/i })
        .getAttribute('href')
    ).toBe('/docs/quick-start');
  });
  it('links to /demo as the secondary CTA', () => {
    const { container } = render(<Home />);
    const hero = container.querySelector('.hx-hero') as HTMLElement;
    expect(
      within(hero)
        .getByRole('link', { name: /see the demo/i })
        .getAttribute('href')
    ).toBe('/demo');
  });
  it('mounts the hero shader background', () => {
    const { container } = render(<Home />);
    const bg = container.querySelector('[aria-hidden="true"]');
    expect(bg?.querySelector('canvas')).not.toBeNull();
  });
  it('renders the hero headline', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('mounts all twelve chapters (headings present)', () => {
    render(<Home />);
    for (const re of [
      /edge to browser/i, // hero
      /runs on the platform/i, // edge
      /routing is a manifest/i, // routing
      /no client waterfall/i, // ssr
      /streams in/i, // streaming
      /without the cliff/i, // mutations
      /degrade, not crash/i, // resilience
      /instant navigation/i, // prefetch
      /transitions, for free/i, // view transitions
      /live, both ways/i, // realtime
      /one package/i, // one package
      /feels alive/i, // cta
    ]) {
      // The hero wordmark renders layered spans (base + gradient fill), so a
      // heading may match more than once; assert presence, not uniqueness.
      expect(screen.getAllByText(re).length).toBeGreaterThan(0);
    }
  });

  it('renders coherently with reduced motion (no pinning path)', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: /reduce/.test(q),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<Home />);
    expect(screen.getByText(/routing is a manifest/i)).toBeInTheDocument();
    expect(screen.getByText(/live, both ways/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
