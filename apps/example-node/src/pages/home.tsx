import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from './home.server.js';

const homeLoader = serverLoaders.default;

const HomePage: FunctionComponent = () => {
  const { message } = homeLoader.useData();
  return (
    <section>
      <h1>example-node</h1>
      <p>{message}</p>
      <a href="/about">About</a>
    </section>
  );
};
HomePage.displayName = 'HomePage';

const HomeView = homeLoader.View(() => <HomePage />, {
  fallback: <p>Loading...</p>,
});

export default definePage(HomeView, {});
