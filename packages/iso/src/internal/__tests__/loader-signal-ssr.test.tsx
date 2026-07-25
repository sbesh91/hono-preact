// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStringAsync } from 'preact-render-to-string';
import { useContext } from 'preact/hooks';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { LoaderDataContext } from '../contexts.js';
import { env } from '../../is-browser.js';
import type { RouteHook } from 'preact-iso';
import type { JSX } from 'preact';

const loc = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;
const original = env.current;

afterEach(() => {
  env.current = original;
});

describe('loader signal under preact-render-to-string', () => {
  it('renders a useData node to the SSR value without throwing', async () => {
    env.current = 'server';
    const loader = defineLoader<{ title: string }>(async () => ({
      title: 'server-title',
    }));

    function View(): JSX.Element {
      const state = loader.useData();
      const t =
        state.value.status === 'loading' ? '(loading)' : state.value.data.title;
      return <h1>{t}</h1>;
    }

    const html = await renderToStringAsync(
      <Loader mode={{ kind: 'single' }} loader={loader} location={loc}>
        <View />
      </Loader>
    );
    expect(html).toContain('server-title');
  });

  it('puts a REAL signal on the loader channel, so peek() works under SSR too', async () => {
    // The server path used to provide a bare `{ value: state }`, which carries
    // none of `ReadonlySignal`'s methods: any consumer reaching past `.value`
    // typechecked green and threw during SSR. Calling `peek()` from inside the
    // suspended `DataReader` subtree is the cheapest thing that fails against
    // that shape.
    env.current = 'server';
    const loader = defineLoader<{ title: string }>(async () => ({
      title: 'server-title',
    }));

    function Peeker(): JSX.Element {
      const source = useContext(LoaderDataContext);
      return <h1>{JSON.stringify(source?.peek() ?? null)}</h1>;
    }

    const html = await renderToStringAsync(
      <Loader mode={{ kind: 'single' }} loader={loader} location={loc}>
        <Peeker />
      </Loader>
    );
    expect(html).toContain('server-title');
  });
});
