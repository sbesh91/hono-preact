import { getLoaderData, type LoaderData, createCache } from '@hono-preact/iso';
import type { FunctionalComponent } from 'preact';
import { lazy, Route, Router, RouteHook } from 'preact-iso';
import type { MovieSummary, MoviesData } from '@/server/data/movies.js';
import serverLoader from './movies.server.js';
import Noop from './noop.js';

const cache = createCache<{ movies: MoviesData }>();

const clientLoader = cache.wrap(async ({}: { location: RouteHook }) => {
  const movies = await fetch('/api/movies').then(
    (res) => res.json() as Promise<MoviesData>
  );
  return { movies };
});

const Movie = lazy(() => import('./movie.js'));

const Movies: FunctionalComponent = (props: LoaderData<{ movies: MoviesData }>) => {
  return (
    <section class="p-1">
      <a href="/" class="bg-amber-200">
        home
      </a>
      {props.loaderData?.movies.results.map((m: MovieSummary) => (
        <a
          href={`/movies/${m.id}`}
          class="border-2 m-1 p-1 inline-block"
          key={m.id}
        >
          {m.title}
        </a>
      ))}

      <Router>
        <Route path="/:id" component={Movie} />
        <Noop />
      </Router>
    </section>
  );
};
Movies.displayName = 'Movies';
Movies.defaultProps = { route: '/movies' };

export default getLoaderData(Movies, {
  serverLoader,
  clientLoader,
  cache,
});
