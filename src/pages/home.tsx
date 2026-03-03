import { getLoaderData } from '@/iso/loader';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';

const Home: FunctionComponent = () => {
  const [toggle, setToggle] = useState(false);
  const [lagging, setLagging] = useState(false);

  return (
    <section class="p-1">
      <a href="/test" class="bg-red-300">
        test
      </a>
      <a href="/movies" class="bg-purple-300">
        movies
      </a>
      <h1 class={`${lagging ? 'bg-green-300' : ''}`}>Hello Hono!</h1>
      <button
        class={`${toggle ? 'bg-blue-300' : ''}`}
        onClick={() => {
          setLagging(toggle);
          setToggle(!toggle);
        }}
      >
        toggle
      </button>
    </section>
  );
};

Home.displayName = 'Home';
Home.defaultProps = { route: '/' };

export default getLoaderData(Home);
