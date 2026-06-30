// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { env } from '../is-browser.js';

const originalEnv = env.current;
afterEach(() => {
  env.current = originalEnv;
});

it('route-independent live loader .View renders connecting on SSR with NO RouteLocationsProvider', () => {
  let invoked = 0;
  async function* live() {
    invoked++;
    yield { n: 1 };
  }
  const ref = defineLoader<{ n: number }>(live, {
    __moduleKey: 'standalone-1',
    live: true,
  });
  const Bar = ref.View<number[]>(
    (s) => (
      <p>
        {(s.status === 'connecting' ? [] : s.data).join(',')}|{s.status}
      </p>
    ),
    { initial: [], reduce: (acc, c) => [...acc, c.n] }
  );
  const App = () => (
    <LocationProvider>
      <Bar />
    </LocationProvider>
  ); // no RouteLocationsProvider
  env.current = 'server';
  const container = document.createElement('div');
  render(<App />, container);
  expect(invoked).toBe(0);
  expect(container.textContent).toContain('connecting');
  render(null, container);
});
