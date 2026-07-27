// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { useContext } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ReadonlySignal } from '@preact/signals';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { LoaderDataContext, type LoaderData } from '../contexts.js';
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

describe('LoaderDataContext provision', () => {
  it('provides a real signal (the whole ReadonlySignal contract, not just .value)', async () => {
    const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }));

    // Every context value the probe observes, in render order. Collected in an
    // array rather than a `let` so the assertions below read a value
    // TypeScript can see was written.
    const seen: (ReadonlySignal<LoaderData> | null)[] = [];
    function Probe(): JSX.Element {
      seen.push(useContext(LoaderDataContext));
      return <span>probe</span>;
    }

    render(
      <Loader mode={{ kind: 'single' }} loader={loader} location={loc}>
        <Probe />
      </Loader>
    );

    const source = seen[0];
    expect(source).not.toBeNull();
    // A consumer may call any `ReadonlySignal` member, not just read `.value`.
    // `peek()` is the one that fails loudest against a bare `{ value }`
    // snapshot, which is the shape the server path used to provide.
    expect(typeof source?.peek).toBe('function');
    expect(typeof source?.subscribe).toBe('function');
    expect(source?.peek()).toEqual(source?.value);

    // The value tracks the loader state through to settlement...
    await waitFor(() =>
      expect(source?.peek()).toEqual({ status: 'success', data: { n: 1 } })
    );
    // ...on the SAME signal instance. A fresh signal per render would freeze
    // every consumer that memoizes a projection off it on first read.
    expect(new Set(seen).size).toBe(1);
  });
});
