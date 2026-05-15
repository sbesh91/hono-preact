import type { FunctionComponent } from 'preact';

const Home: FunctionComponent = () => (
  <section class="p-1">
    <h1>hono-preact</h1>
    <p>Landing page coming up.</p>
    <p>
      <a href="/docs">Docs</a> · <a href="/demo">Demo</a>
    </p>
  </section>
);
Home.displayName = 'Home';

export default Home;
