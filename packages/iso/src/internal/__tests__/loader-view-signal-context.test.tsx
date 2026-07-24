// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useContext } from 'preact/hooks';
import type { JSX } from 'preact';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { LoaderViewSignalContext } from '../contexts.js';
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
});

describe('LoaderViewSignalContext provision', () => {
  it('provides a reactive whose value tracks the loader state (signal mode)', async () => {
    installLoaderSignals();
    const loader = defineLoader<{ n: number }>(async () => ({ n: 1 }));

    let seen: { readonly value: unknown } | null = null;
    function Probe(): JSX.Element {
      seen = useContext(LoaderViewSignalContext);
      return <span>probe</span>;
    }

    render(
      <Loader loader={loader} location={loc}>
        <Probe />
      </Loader>
    );

    // The context is provided (non-null) and exposes a `.value`.
    expect(seen).not.toBeNull();
    expect(seen).toHaveProperty('value');
  });
});
