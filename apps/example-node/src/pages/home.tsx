import { definePage, useAction } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders, serverActions } from './home.server.js';

const homeLoader = serverLoaders.default;
const countLoader = serverLoaders.count;

const HomePage: FunctionComponent = () => {
  const { message } = homeLoader.useData();
  return (
    <section>
      <h1>example-node</h1>
      <p>{message}</p>
      <LiveCounter />
      <a href="/about">About</a>
    </section>
  );
};
HomePage.displayName = 'HomePage';

// Accumulating live view: data is the latest count pushed over the channel.
// Open two tabs and click Increment in one; both update live.
const LiveCounter = countLoader.View<number>(
  ({ data, status }) => {
    const inc = useAction(serverActions.increment);
    return (
      <p>
        Live count: <strong>{data}</strong> ({status}){' '}
        <button
          type="button"
          disabled={inc.pending}
          onClick={() => inc.mutate({})}
        >
          Increment
        </button>
      </p>
    );
  },
  {
    initial: 0,
    reduce: (_acc, chunk) => chunk.count,
    fallback: <p>Live count: connecting...</p>,
  }
);

const HomeView = homeLoader.View(() => <HomePage />, {
  fallback: <p>Loading...</p>,
});

export default definePage(HomeView, {});
