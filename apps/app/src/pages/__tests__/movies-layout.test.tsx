// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviesLayout from '../movies-layout.js';

afterEach(() => cleanup());

describe('MoviesLayout SearchInput', () => {
  it('renders a search input labeled "Search movies"', async () => {
    render(
      <LocationProvider>
        <MoviesLayout>
          <p>child</p>
        </MoviesLayout>
      </LocationProvider>
    );
    const input = await screen.findByLabelText(/search movies/i);
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});
