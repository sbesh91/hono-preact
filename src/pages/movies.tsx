import { getLoaderData, type LoaderData } from '@/iso/loader.js';
import type { FunctionalComponent } from 'preact';
import { lazy, Route, Router, RouteHook } from 'preact-iso';
import serverLoader /*, { serverGuards }*/ from './movies.server.js';
// import { createGuard } from '../iso/guard.js';
import { createCache } from '@/iso/cache.js';
import Noop from './noop.js';

const cache = createCache<{ movies: any }>();

const clientLoader = cache.wrap(async ({}: { location: RouteHook }) => {
  const movies = await fetch('/api/movies')
    .then((res) => res.json())
    .catch(console.log);
  return { movies };
}, '/movies');

const Movie = lazy(() => import('./movie.js'));

const Movies: FunctionalComponent = (props: LoaderData<{ movies: any }>) => {
  return (
    <section class="p-1">
      <a href="/" class="bg-amber-200">
        home
      </a>
      {props.loaderData?.movies.results.map((m: any) => (
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

// const clientGuards = [
//   createGuard(async (_ctx, _next) => {
//     return { redirect: '/test' };
//   }),
// ];

export default getLoaderData(Movies, {
  serverLoader,
  clientLoader,
  cache,
  // serverGuards,
  // clientGuards,
});
