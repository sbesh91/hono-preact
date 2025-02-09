import { useSignal } from "@preact/signals";
import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";

export const Home: FunctionComponent = () => {
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
        onClick={(e) => {
          setToggle(!toggle);
          signal.value = toggle;
        }}
      >
        toggle
      </button>
    </section>
  );
};

export default Home;
