// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStringAsync } from 'preact-render-to-string';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { installLoaderSignals } from '../../signals.js';
import {
  registerLoaderReactiveImpl,
  getLoaderReactiveImpl,
} from '../reactive.js';
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
  registerLoaderReactiveImpl(null);
});

describe('loader signal under preact-render-to-string', () => {
  it('renders a useFieldSignal node to the SSR value without throwing', async () => {
    installLoaderSignals();
    expect(getLoaderReactiveImpl()).not.toBeNull();
    env.current = 'server';
    const loader = defineLoader<{ title: string }>(async () => ({
      title: 'server-title',
    }));

    function View(): JSX.Element {
      const t = loader.useFieldSignal((d) => d.title, '(loading)');
      return <h1>{t.value}</h1>;
    }

    const html = await renderToStringAsync(
      <Loader loader={loader} location={loc}>
        <View />
      </Loader>
    );
    expect(html).toContain('server-title');
  });
});
