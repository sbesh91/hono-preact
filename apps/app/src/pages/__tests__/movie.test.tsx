// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import MoviePage from '../movie.js';
import { serverLoaders } from '../movie.server.js';
import { RouteLocationsContext } from 'hono-preact/internal';

// In happy-dom, isBrowser() returns true, which would send the loader over
// the network. Suppress it so the spy on loader.fn is actually called.
vi.mock('@hono-preact/iso/is-browser.js', () => ({
  isBrowser: () => false,
  env: { current: 'server' },
}));

const loader = serverLoaders.default;

// The moduleKeyPlugin injects __moduleKey at build time but not in unit tests.
// Set it now so LoaderHost can look up the location from RouteLocationsContext.
const TEST_MODULE_KEY = 'pages/movie-test';
beforeAll(() => {
  Object.defineProperty(loader, '__moduleKey', {
    value: TEST_MODULE_KEY,
    configurable: true,
  });
});

const testLocation = {
  url: '/movies/1241982',
  path: '/movies/1241982',
  query: '',
  pathParams: { id: '1241982' },
  searchParams: {},
  route: () => {},
} as any;

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

    const locMap = new Map([[TEST_MODULE_KEY, testLocation]]);

    render(
      <RouteLocationsContext.Provider value={locMap}>
        <LocationProvider scope="/movies/1241982">
          <MoviePage path="/movies/:id" pathParams={{ id: '1241982' }} searchParams={{}} />
        </LocationProvider>
      </RouteLocationsContext.Provider>
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
