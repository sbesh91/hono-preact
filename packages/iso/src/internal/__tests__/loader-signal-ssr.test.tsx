// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStringAsync } from 'preact-render-to-string';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
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
      <Loader loader={loader} location={loc}>
        <View />
      </Loader>
    );
    expect(html).toContain('server-title');
  });
});
