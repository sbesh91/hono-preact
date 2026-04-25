import { getLoaderData, WrapperProps, type LoaderData } from '@hono-preact/iso';
import type { FunctionalComponent } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { Movie } from '@/server/data/movie.js';
import serverLoader from './movie.server.js';

const Movie: FunctionalComponent<LoaderData<{ movie: Movie | null }>> = (
  props
) => {
  return (
    <section class="p-1">
      <a href="/movies" class="bg-red-200">
        movies
      </a>
      <span>{props.loaderData?.movie?.title}</span>
      <a class="block" href="/movies/1241982">
        next movie
      </a>
    </section>
  );
};
Movie.displayName = 'Movie';
Movie.defaultProps = { route: '/movies/:id' };

function MovieWrapper(props: WrapperProps) {
  return <article {...props} />;
}

export default getLoaderData(Movie, {
  serverLoader,
  Wrapper: MovieWrapper,
});
