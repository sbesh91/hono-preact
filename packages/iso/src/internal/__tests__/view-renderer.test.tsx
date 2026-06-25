// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { render } from '@testing-library/preact';
import { ViewRenderer, type ViewRenderArgs } from '../view-renderer.js';
import type { LoaderRef } from '../../define-loader.js';
import { LoaderDataContext } from '../contexts.js';
import { LoaderStatusContext } from '../loader.js';
import { ReloadContext } from '../../reload-context.js';

describe('ViewRenderer', () => {
  it('hands data/loading/status/error/reload + spread props to the render function', () => {
    let captured: ViewRenderArgs | undefined;
    let reloaded = false;
    const loaderRef = {
      useError: () => null,
    } as unknown as LoaderRef<unknown, boolean>;

    render(
      h(
        LoaderDataContext.Provider,
        { value: { data: { n: 1 }, loading: false } },
        h(
          LoaderStatusContext.Provider,
          { value: 'open' },
          h(
            ReloadContext.Provider,
            {
              value: {
                reload: () => {
                  reloaded = true;
                },
              },
            },
            h(ViewRenderer, {
              loaderRef,
              props: { extra: 'x' },
              render: (args: ViewRenderArgs) => {
                captured = args;
                return null;
              },
            })
          )
        )
      )
    );

    expect(captured?.data).toEqual({ n: 1 });
    expect(captured?.loading).toBe(false);
    expect(captured?.status).toBe('open');
    expect(captured?.error).toBeNull();
    expect(captured?.extra).toBe('x');
    captured?.reload();
    expect(reloaded).toBe(true);
  });

  it('carries loading=true with data=undefined for a pending loader', () => {
    let captured: ViewRenderArgs | undefined;
    const loaderRef = {
      useError: () => null,
    } as unknown as LoaderRef<unknown, boolean>;

    render(
      h(
        LoaderDataContext.Provider,
        { value: { data: undefined, loading: true } },
        h(ViewRenderer, {
          loaderRef,
          props: {},
          render: (args: ViewRenderArgs) => {
            captured = args;
            return null;
          },
        })
      )
    );

    expect(captured?.loading).toBe(true);
    expect(captured?.data).toBeUndefined();
  });

  it('surfaces the loader error from useError() and defaults status/reload/loading', () => {
    let captured: ViewRenderArgs | undefined;
    const err = new Error('loader failed');
    const loaderRef = {
      useError: () => err,
    } as unknown as LoaderRef<unknown, boolean>;

    render(
      h(
        LoaderDataContext.Provider,
        { value: { data: undefined, loading: false } },
        h(ViewRenderer, {
          loaderRef,
          props: {},
          render: (args: ViewRenderArgs) => {
            captured = args;
            return null;
          },
        })
      )
    );

    expect(captured?.error).toBe(err);
    // No LoaderStatusContext / ReloadContext providers: defaults apply.
    expect(captured?.status).toBe('connecting');
    expect(typeof captured?.reload).toBe('function');
    // No LoaderDataContext loading reported as false default when absent is
    // covered by the explicit-context case above; here loading is provided.
    expect(captured?.loading).toBe(false);
  });
});
