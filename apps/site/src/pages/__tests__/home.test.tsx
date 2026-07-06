// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import Home from '../home.js';

afterEach(() => cleanup());

describe('home (scroll experience)', () => {
  it('links to /docs/quick-start as the primary CTA', () => {
    render(<Home />);
    expect(screen.getByRole('link', { name: /get started/i }).getAttribute('href')).toBe(
      '/docs/quick-start'
    );
  });
  it('links to /demo as the secondary CTA', () => {
    render(<Home />);
    expect(screen.getByRole('link', { name: /see the demo/i }).getAttribute('href')).toBe('/demo');
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
});
