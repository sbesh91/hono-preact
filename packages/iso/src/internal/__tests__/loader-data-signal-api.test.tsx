// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import type { JSX } from 'preact';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { registerLoaderReactiveImpl } from '../reactive.js';
import type { RouteHook } from 'preact-iso';

const loc = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

afterEach(() => {
  cleanup();
  registerLoaderReactiveImpl(null);
  vi.restoreAllMocks();
});

describe('useDataSignal / useFieldSignal (default mode, no signals entry)', () => {
  it('reads the current loader state and a projected field', async () => {
    const loader = defineLoader<{ title: string }>(async () => ({
      title: 'hi',
    }));

    function View(): JSX.Element {
      const s = loader.useDataSignal();
      const title = loader.useFieldSignal((d) => d.title, '(loading)');
      const status = s.value.status;
      return (
        <p data-testid="v">
          {status}:{title.value}
        </p>
      );
    }

    render(
      <Loader loader={loader} location={loc}>
        <View />
      </Loader>
    );
    // On first client render the loader is loading (no cache/preload here).
    expect(screen.getByTestId('v').textContent).toContain('(loading)');
  });

  it('throws a clear error when called outside a <Loader>', () => {
    const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }));
    function Bare(): JSX.Element {
      loader.useDataSignal();
      return <span />;
    }
    expect(() => render(<Bare />)).toThrow(/useDataSignal/);
  });
});
