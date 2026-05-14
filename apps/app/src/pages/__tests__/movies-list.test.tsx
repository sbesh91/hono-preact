// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviesList from '../movies-list.js';
import { serverLoaders } from '../movies-list.server.js';
import { serverLoaders as watchedLoaders } from '../watched.server.js';
import MoviesLayout from '../movies-layout.js';
import { RouteLocationsContext } from 'hono-preact/internal';

// In happy-dom, isBrowser() returns true, which would send the loader over
// the network. Suppress it so spies on loader.fn are actually called.
vi.mock('@hono-preact/iso/is-browser.js', () => ({
  isBrowser: () => false,
  env: { current: 'server' },
}));

const loader = serverLoaders.default;
const watchedLoader = watchedLoaders.default;

// The moduleKeyPlugin injects __moduleKey at build time but not in unit tests.
// Set a stable key so LoaderHost can look up the location from RouteLocationsContext.
const LIST_MODULE_KEY = 'pages/movies-list-test';
beforeAll(() => {
  Object.defineProperty(loader, '__moduleKey', {
    value: LIST_MODULE_KEY,
    configurable: true,
  });
});

const moviesLocation = {
  url: '/movies',
  path: '/movies',
  query: '',
  pathParams: {},
  searchParams: {},
  route: () => {},
} as any;

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

    const locMap = new Map([[LIST_MODULE_KEY, moviesLocation]]);

    render(
      <RouteLocationsContext.Provider value={locMap}>
        <LocationProvider>
          <MoviesLayout>
            <MoviesList path="/movies" pathParams={{}} searchParams={{}} />
          </MoviesLayout>
        </LocationProvider>
      </RouteLocationsContext.Provider>
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

    const locMap = new Map([[LIST_MODULE_KEY, moviesLocation]]);

    render(
      <RouteLocationsContext.Provider value={locMap}>
        <LocationProvider>
          <MoviesLayout>
            <MoviesList path="/movies" pathParams={{}} searchParams={{ q: 'moana' }} />
          </MoviesLayout>
        </LocationProvider>
      </RouteLocationsContext.Provider>
    );

    await screen.findByText('Exact matches');
    expect(screen.getByText('Moana 2')).toBeInTheDocument();
  });
});
