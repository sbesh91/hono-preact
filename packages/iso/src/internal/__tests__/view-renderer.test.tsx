// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import { render } from '@testing-library/preact';
import { ViewRenderer, type ViewState } from '../view-renderer.js';
import type { LoaderRef } from '../../define-loader.js';
import type { StreamStatus } from '../use-loader-runner.js';
import { LoaderDataContext } from '../contexts.js';
import { LoaderStatusContext } from '../loader.js';
import { ReloadContext } from '../../reload-context.js';

// Mounts `ViewRenderer` inside the three loader contexts it reads
// (`LoaderDataContext` for data/loading, `LoaderStatusContext` for the
// streaming status, `ReloadContext` for the reload callback) with the given
// loose values, plus a stub `loaderRef` carrying `live` + `useError()`. It
// captures whatever union `ViewRenderer` projects and hands the render fn.
function renderViewRenderer(
  ctx: {
    data: unknown;
    loading?: boolean;
    status?: StreamStatus;
    live?: boolean;
    error?: Error | null;
    props?: Record<string, unknown>;
  },
  renderFn: (args: ViewState) => ComponentChildren
) {
  const loaderRef = {
    live: ctx.live ?? false,
    useError: () => ctx.error ?? null,
  } as unknown as LoaderRef<unknown, boolean>;

  render(
    h(
      LoaderDataContext.Provider,
      { value: { data: ctx.data, loading: ctx.loading ?? false } },
      h(
        LoaderStatusContext.Provider,
        { value: ctx.status ?? 'connecting' },
        h(
          ReloadContext.Provider,
          { value: { reload: () => {}, reloading: false } },
          h(ViewRenderer, {
            loaderRef,
            props: ctx.props ?? {},
            render: renderFn,
          })
        )
      )
    )
  );
}

describe('ViewRenderer', () => {
  it('passes a discriminated LoaderState to the render fn (single-value)', () => {
    const seen: ViewState[] = [];
    renderViewRenderer(
      { data: { title: 'Dune' }, loading: false, live: false },
      (s) => {
        seen.push(s);
        return null;
      }
    );
    expect(seen[0]).toEqual({ status: 'success', data: { title: 'Dune' } });
  });

  it('passes a StreamState for live loaders', () => {
    const seen: ViewState[] = [];
    renderViewRenderer(
      { data: undefined, status: 'connecting', live: true },
      (s) => {
        seen.push(s);
        return null;
      }
    );
    expect(seen[0]).toEqual({ status: 'connecting' });
  });

  it('reports the single-value loading arm (cold load, no data)', () => {
    const seen: ViewState[] = [];
    renderViewRenderer({ data: undefined, loading: true, live: false }, (s) => {
      seen.push(s);
      return null;
    });
    expect(seen[0]).toEqual({ status: 'loading' });
  });

  it('reports the revalidating arm (reload over prior data)', () => {
    const seen: ViewState[] = [];
    renderViewRenderer(
      { data: { title: 'Dune' }, loading: true, live: false },
      (s) => {
        seen.push(s);
        return null;
      }
    );
    expect(seen[0]).toEqual({
      status: 'revalidating',
      data: { title: 'Dune' },
    });
  });

  it('reports the streaming open arm once a chunk has arrived', () => {
    const seen: ViewState[] = [];
    renderViewRenderer(
      { data: { count: 2 }, status: 'open', live: true },
      (s) => {
        seen.push(s);
        return null;
      }
    );
    expect(seen[0]).toEqual({ status: 'open', data: { count: 2 } });
  });

  it('surfaces a cold loader error as the error arm', () => {
    const err = new Error('loader failed');
    const seen: ViewState[] = [];
    renderViewRenderer(
      { data: { title: 'Dune' }, loading: false, live: false, error: err },
      (s) => {
        seen.push(s);
        return null;
      }
    );
    expect(seen[0]).toEqual({
      status: 'error',
      error: err,
      data: { title: 'Dune' },
    });
  });

  it('merges spread props into the projected union', () => {
    const seen: ViewState[] = [];
    renderViewRenderer(
      {
        data: { title: 'Dune' },
        loading: false,
        live: false,
        props: { extra: 'x' },
      },
      (s) => {
        seen.push(s);
        return null;
      }
    );
    expect(seen[0]).toEqual({
      status: 'success',
      data: { title: 'Dune' },
      extra: 'x',
    });
  });
});
