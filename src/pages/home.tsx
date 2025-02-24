import ExampleMenu from "@/components/menu";
import { getLoaderData } from "@/iso/loader";
import { useSignal } from "@preact/signals";
import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";

const Home: FunctionComponent = () => {
  const [toggle, setToggle] = useState(false);
  const signal = useSignal(toggle);

  return (
    <section class="p-1">
      <a href="/test" class="bg-red-300">
        test
      </a>
      <a href="/movies" class="bg-purple-300">
        movies
      </a>
      <h1 class={`${signal.value ? "bg-green-300" : ""}`}>Hello Hono!</h1>
      <button
        class={`${toggle ? "bg-blue-300" : ""}`}
        onClick={() => {
          setToggle(!toggle);
          signal.value = toggle;
        }}
      >
        toggle
      </button>
      <ExampleMenu />
    </section>
  );
};

Home.displayName = "Home";
Home.defaultProps = { route: "/" };

export default getLoaderData(Home);
