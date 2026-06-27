// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import { render, cleanup } from '@testing-library/preact';
import { ViewRenderer, type ViewState } from '../view-renderer.js';
import type { LoaderState, StreamState } from '../../loader-state.js';
import { LoaderDataContext } from '../contexts.js';

afterEach(() => {
  cleanup();
});

// Mounts `ViewRenderer` under a `LoaderDataContext` already carrying the
// PROJECTED union (the projection now happens once in `loader.tsx`, not here).
// ViewRenderer's job is to read that union and merge the consumer's spread
// props, so these assert it passes the union through unchanged (plus props).
function renderViewRenderer(
  state: LoaderState<unknown> | StreamState<unknown>,
  renderFn: (args: ViewState) => ComponentChildren,
  props: Record<string, unknown> = {}
) {
  render(
    h(
      LoaderDataContext.Provider,
      { value: state },
      h(ViewRenderer, { props, render: renderFn })
    )
  );
}

describe('ViewRenderer', () => {
  it('passes a single-value LoaderState through to the render fn', () => {
    const seen: ViewState[] = [];
    renderViewRenderer({ status: 'success', data: { title: 'Dune' } }, (s) => {
      seen.push(s);
      return null;
    });
    expect(seen[0]).toEqual({ status: 'success', data: { title: 'Dune' } });
  });

  it('passes a StreamState (connecting) through to the render fn', () => {
    const seen: ViewState[] = [];
    renderViewRenderer({ status: 'connecting' }, (s) => {
      seen.push(s);
      return null;
    });
    expect(seen[0]).toEqual({ status: 'connecting' });
  });

  it('passes the single-value loading arm through', () => {
    const seen: ViewState[] = [];
    renderViewRenderer({ status: 'loading' }, (s) => {
      seen.push(s);
      return null;
    });
    expect(seen[0]).toEqual({ status: 'loading' });
  });

  it('passes the revalidating arm through', () => {
    const seen: ViewState[] = [];
    renderViewRenderer(
      { status: 'revalidating', data: { title: 'Dune' } },
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

  it('passes the streaming open arm through', () => {
    const seen: ViewState[] = [];
    renderViewRenderer({ status: 'open', data: { count: 2 } }, (s) => {
      seen.push(s);
      return null;
    });
    expect(seen[0]).toEqual({ status: 'open', data: { count: 2 } });
  });

  it('passes the error arm through', () => {
    const err = new Error('loader failed');
    const seen: ViewState[] = [];
    renderViewRenderer(
      { status: 'error', error: err, data: { title: 'Dune' } },
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

  it('merges spread props into the union', () => {
    const seen: ViewState[] = [];
    renderViewRenderer(
      { status: 'success', data: { title: 'Dune' } },
      (s) => {
        seen.push(s);
        return null;
      },
      { extra: 'x' }
    );
    expect(seen[0]).toEqual({
      status: 'success',
      data: { title: 'Dune' },
      extra: 'x',
    });
  });

  it('throws when rendered outside a Loader (no context)', () => {
    expect(() =>
      render(h(ViewRenderer, { props: {}, render: () => null }))
    ).toThrow(/loader\.View/);
  });
});
