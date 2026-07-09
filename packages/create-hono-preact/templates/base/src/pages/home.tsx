import { definePage } from 'hono-preact';
import { serverLoaders } from './home.server.js';

// `.View(render)` wraps the render in the loader's error boundary and data
// context. `data` is absent only while the loader is cold, so the truthy
// check doubles as the loading guard.
const HomeView = serverLoaders.default.View(({ data }) =>
  data ? (
    <section>
      <h1>Welcome to {'{{name}}'}</h1>
      <p>{data.message}</p>
      <p>
        <small>Rendered at {data.renderedAt}</small>
      </p>
      <a href="/about">About</a>
    </section>
  ) : (
    <p>Loading...</p>
  )
);

export default definePage(HomeView);
