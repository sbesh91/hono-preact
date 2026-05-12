// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviePage from '../movie.js';
import { loader } from '../movie.server.js';

afterEach(() => {
  cleanup();
  loader.cache.invalidate();
});

describe('MoviePage streaming sections', () => {
  it('renders the four section headings and content from a single-yield mock', async () => {
    vi.spyOn(loader, 'fn').mockImplementation(
      async function* () {
        yield {
          movie: { id: 1241982, title: 'Moana 2', overview: '...' } as never,
          watched: null,
          watchedCount: 0,
          summary: 'streamed summary text',
          cast: [{ name: 'Actor A', role: 'Lead' }],
          similar: [],
          boxOffice: { budget: 1, revenue: 2, openingWeekend: 3, screens: 4 },
        };
      } as never
    );

    render(
      <LocationProvider scope="/movies/1241982">
        <MoviePage path="/movies/:id" pathParams={{ id: '1241982' }} searchParams={{}} />
      </LocationProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Summary')).toBeInTheDocument();
      expect(screen.getByText('Cast')).toBeInTheDocument();
      expect(screen.getByText('Similar movies')).toBeInTheDocument();
      expect(screen.getByText('Box office')).toBeInTheDocument();
      expect(screen.getByText('streamed summary text')).toBeInTheDocument();
      expect(screen.getByText(/Actor A/)).toBeInTheDocument();
    });
  });
});
