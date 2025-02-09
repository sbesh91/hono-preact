import { getLoaderData } from "@/server/loader.js";

async function loader() {
  return { test: "Hello World" };
}

export const Movies = getLoaderData((props) => {
  console.log(props);
  return (
    <section class="p-1">
      <a href="/" class="bg-amber-200">
        home
      </a>

      {props.loaderData.test}
    </section>
  );
}, loader);

export default Movies;
