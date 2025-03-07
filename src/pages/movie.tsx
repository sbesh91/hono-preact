import ExampleDialog from '@/components/component';
import { getLoaderData, type LoaderData } from '@/iso/loader.js';
import { getMovie } from '@/server/movies.js';
import type { FunctionalComponent } from 'preact';
import { LocationHook } from 'preact-iso';

async function serverLoader({ location }: { location: LocationHook }) {
  const movie = await getMovie(location.pathParams.id);
  return { movie };
}

async function clientLoader({ location }: { location: LocationHook }) {
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
      <ExampleDialog />
      <a href="/movies/1241982">next movie</a>
    </section>
  );
};
Movie.displayName = 'Movie';
Movie.defaultProps = { route: '/movies/:id' };

export default getLoaderData(Movie, { serverLoader, clientLoader });
