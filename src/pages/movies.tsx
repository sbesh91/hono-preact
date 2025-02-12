import { getLoaderData, type LoaderData } from "@/iso/loader.js";
import { getMovies } from "@/server/movies.js";
import type { FunctionalComponent } from "preact";
import { LocationHook } from "preact-iso";

async function loader({}: { location: LocationHook }) {
  const movies = await getMovies();
  return { movies };
}

async function clientLoader({}: { location: LocationHook }) {
  const movies = await fetch("/api/movies")
    .then((res) => res.json())
    .catch(console.log);
  return { movies };
}

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
    </section>
  );
};
Movies.displayName = "Movies";

export default getLoaderData(Movies, loader, clientLoader);
