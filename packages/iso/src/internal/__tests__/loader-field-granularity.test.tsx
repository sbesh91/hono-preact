// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/preact';
import type { JSX } from 'preact';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { useReload } from '../../reload-context.js';
import { installLoaderSignals } from '../../signals.js';
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
  vi.unstubAllGlobals();
});

describe('loader field granularity through <Loader> (signal mode)', () => {
  it('a field change re-renders only the bound field node, not a sibling field', async () => {
    installLoaderSignals();
    // A loader whose value changes across reloads.
    let n = 1;
    const loader = defineLoader<{ a: number; b: number }>(async () => ({
      a: n,
      b: 100,
    }));

    const titleRenders = vi.fn();
    const otherRenders = vi.fn();
    let doReload: () => void = () => {};

    function TitleField(): JSX.Element {
      titleRenders();
      const a = loader.useFieldSignal((d) => d.a, 0);
      return <p data-testid="a">{a.value}</p>;
    }
    function OtherField(): JSX.Element {
      otherRenders();
      const b = loader.useFieldSignal((d) => d.b, 0);
      return <p data-testid="b">{b.value}</p>;
    }
    function ReloadButton(): JSX.Element {
      doReload = useReload().reload;
      return <span />;
    }

    render(
      <Loader loader={loader} location={loc}>
        <TitleField />
        <OtherField />
        <ReloadButton />
      </Loader>
    );

    // The direct-fn dispatch path resolves through a dynamic import (kept off
    // client bundles), a real task turn rather than a single microtask, so the
    // settle wait must poll (as the rest of this suite does) rather than await
    // one `Promise.resolve()` tick.
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('1'));
    expect(screen.getByTestId('b').textContent).toBe('100');
    const otherBefore = otherRenders.mock.calls.length;

    // Change only field `a`, then reload.
    n = 2;
    act(() => {
      doReload();
    });

    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('2'));
    // `b` is unchanged; its bound component must NOT have re-rendered from the
    // field-`a` change (it subscribed only to `b`'s projection).
    expect(screen.getByTestId('b').textContent).toBe('100');
    expect(otherRenders.mock.calls.length).toBe(otherBefore);
  });
});
