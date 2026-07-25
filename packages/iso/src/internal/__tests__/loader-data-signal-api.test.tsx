// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/preact';
import type { JSX } from 'preact';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import type { RouteHook } from 'preact-iso';

const loc = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useData (always-on signal cell)', () => {
  it('settles to the resolved value (does not freeze at loading)', async () => {
    const loader = defineLoader<{ title: string }>(async () => ({
      title: 'settled',
    }));

    function View(): JSX.Element {
      const state = loader.useData();
      const title =
        state.value.status === 'loading' ? '(loading)' : state.value.data.title;
      return <p data-testid="w">{title}</p>;
    }

    render(
      <Loader loader={loader} location={loc}>
        <View />
      </Loader>
    );

    await waitFor(() =>
      expect(screen.getByTestId('w').textContent).toBe('settled')
    );
  });

  it('throws a clear error when called outside a <Loader>', () => {
    const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }));
    function Bare(): JSX.Element {
      loader.useData();
      return <span />;
    }
    expect(() => render(<Bare />)).toThrow(/useData/);
  });
});
