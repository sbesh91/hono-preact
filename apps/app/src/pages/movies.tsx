import {
  getLoaderData,
  type LoaderData,
  createCache,
  Form,
} from '@hono-preact/iso';
import type { FunctionalComponent } from 'preact';
import { lazy, Route, Router } from 'preact-iso';
import type { MovieSummary, MoviesData } from '@/server/data/movies.js';
import serverLoader, { serverActions } from './movies.server.js';
import Noop from './noop.js';

const cache = createCache<{ movies: MoviesData }>('movies');

const Movie = lazy(() => import('./movie.js'));

const Movies: FunctionalComponent<LoaderData<{ movies: MoviesData }>> = (
  props
) => {
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

      <Form
        action={serverActions.addMovie}
        invalidate="auto"
        class="mt-4 flex gap-2"
      >
        <input name="title" placeholder="Title" class="border p-1" />
        <input name="year" placeholder="Year" class="border p-1 w-20" />
        <button type="submit" class="bg-blue-500 text-white px-3 py-1">
          Add Movie
        </button>
      </Form>

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
  cache,
});
