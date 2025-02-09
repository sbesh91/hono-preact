import { context } from "@/server/context.js";
import { getLoaderData, type LoaderData } from "@/server/loader.js";
import { getMovies } from "@/server/movies.js";

async function loader() {
  const movies = await getMovies();
  return { movies };
}

export const Movies = (props: LoaderData<{ movies: any }>) => {
  if (!context.value) {
    console.log(props);
  }

  return (
    <section class="p-1">
      <a href="/" class="bg-amber-200">
        home
      </a>
      {props.loaderData?.movies.results.map((m: any) => (
        <div class="border-2 m-1 p-1" key={m.id}>
          {m.title}
        </div>
      ))}
    </section>
  );
};

export default getLoaderData(Movies, loader);
