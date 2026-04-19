import { getLoaderData, type LoaderData } from '@hono-preact/iso';
import type { FunctionalComponent } from 'preact';
import type { RouteHook } from 'preact-iso';
import serverLoader from './movie.server.js';

async function clientLoader({ location }: { location: RouteHook }) {
  const movie = await fetch(`/api/movies/${location.pathParams.id}`)
    .then((res) => res.json())
    .catch(console.log);

  return { movie };
}

const Movie: FunctionalComponent = (props: LoaderData<{ movie: any }>) => {
  return (
    <section class="p-1">
      <a href="/movies" class="bg-red-200">
        movies
      </a>
      {props.loaderData?.movie?.title}
      <a class="block" href="/movies/1241982">
        next movie
      </a>
    </section>
  );
};
Movie.displayName = 'Movie';
Movie.defaultProps = { route: '/movies/:id' };

export default getLoaderData(Movie, { serverLoader, clientLoader });
