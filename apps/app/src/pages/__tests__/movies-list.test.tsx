// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviesList from '../movies-list.js';
import { loader } from '../movies-list.server.js';
import { loader as watchedLoader } from '../watched.server.js';
import MoviesLayout from '../movies-layout.js';

afterEach(() => {
  cleanup();
  loader.cache.invalidate();
  watchedLoader.cache.invalidate();
});

const oneMovie = {
  id: 1,
  title: 'Moana 2',
  overview: '',
  release_date: '',
  vote_average: 0,
  vote_count: 0,
  poster_path: '',
  backdrop_path: '',
  genre_ids: [],
  popularity: 0,
  adult: false,
  original_language: 'en',
  original_title: '',
  video: false,
};

describe('MoviesList branches on data.mode', () => {
  it('renders plain list when mode === "list"', async () => {
    vi.spyOn(loader, 'fn').mockImplementation(async function* () {
      yield {
        mode: 'list',
        movies: { page: 1, total_pages: 1, total_results: 1, results: [oneMovie] },
        watchedIds: [],
      };
    } as never);

    render(
      <LocationProvider>
        <MoviesLayout>
          <MoviesList path="/movies" pathParams={{}} searchParams={{}} />
        </MoviesLayout>
      </LocationProvider>
    );

    await screen.findByText('Moana 2');
  });

  it('renders bucket headings when mode === "buckets"', async () => {
    vi.spyOn(loader, 'fn').mockImplementation(async function* () {
      yield {
        mode: 'buckets',
        query: 'moana',
        buckets: {
          exact: [oneMovie],
          titleSubstring: [],
          overview: [],
          genre: [],
        },
        watchedIds: [],
      };
    } as never);

    render(
      <LocationProvider>
        <MoviesLayout>
          <MoviesList path="/movies" pathParams={{}} searchParams={{ q: 'moana' }} />
        </MoviesLayout>
      </LocationProvider>
    );

    await screen.findByText('Exact matches');
    expect(screen.getByText('Moana 2')).toBeInTheDocument();
  });
});
