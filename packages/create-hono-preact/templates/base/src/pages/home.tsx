import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from './home.server.js';

const homeLoader = serverLoaders.default;

const HomePage: FunctionComponent = () => {
  const { data } = homeLoader.useData();
  if (!data) return <p>Loading...</p>;
  const { message, renderedAt } = data;
  return (
    <section>
      <h1>Welcome to {'{{name}}'}</h1>
      <p>{message}</p>
      <p>
        <small>Rendered at {renderedAt}</small>
      </p>
      <a href="/about">About</a>
    </section>
  );
};
HomePage.displayName = 'HomePage';

const HomeView = homeLoader.View(({ data }) =>
  data ? <HomePage /> : <p>Loading...</p>
);

export default definePage(HomeView, {});
