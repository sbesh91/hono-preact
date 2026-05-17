// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import Home from '../home.js';

afterEach(() => cleanup());

describe('home (marketing landing)', () => {
  it('renders the pitch sentence', () => {
    render(<Home />);
    expect(screen.getByText(/manifest driven routes/i)).toBeInTheDocument();
  });

  it('links to /docs/quick-start as the primary CTA', () => {
    render(<Home />);
    const link = screen.getByRole('link', { name: /get started/i });
    expect(link.getAttribute('href')).toBe('/docs/quick-start');
  });

  it('links to /demo as the secondary CTA', () => {
    render(<Home />);
    const link = screen.getByRole('link', { name: /see the demo/i });
    expect(link.getAttribute('href')).toBe('/demo');
  });

  it('shows all four feature cards', () => {
    render(<Home />);
    // Use unique card-caption text to avoid colliding with hero/footer/etc.
    expect(
      screen.getByText(/your routes are a data structure/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/loaders and actions are typed functions/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/loaders, forms, sse/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing else to install/i)).toBeInTheDocument();
  });
});
