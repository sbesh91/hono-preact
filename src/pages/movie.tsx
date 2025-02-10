import { getLoaderData, type LoaderData } from "@/iso/loader.js";
import { getMovie } from "@/server/movies.js";
import type { FunctionalComponent } from "preact";
import { exec } from "preact-iso/router";

export async function loader() {
  const { id } = exec(globalThis.location.pathname, "/movies/:id");
  const movie = await getMovie(id);

  return { movie };
}

export async function clientLoader() {
  const { id } = exec(globalThis.location.pathname, "/movies/:id");
  const movie = await fetch(`/api/movies/${id}`)
    .then((res) => res.json())
    .catch(console.log);

  return { movie };
}

export const Movie: FunctionalComponent = (
  props: LoaderData<{ movie: any }>
) => {
  return (
    <section class="p-1">
      <a href="/movies" class="bg-red-200">
        movies
      </a>
      {props.loaderData?.movie?.title}
    </section>
  );
};

export default getLoaderData(Movie, loader, clientLoader);
