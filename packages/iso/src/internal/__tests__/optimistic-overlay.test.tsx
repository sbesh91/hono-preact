// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useContext } from 'preact/hooks';
import { OptimisticOverlay } from '../optimistic-overlay.js';
import { LoaderDataContext } from '../contexts.js';
import { defineLoader } from '../../define-loader.js';

afterEach(() => {
  cleanup();
});

type Todo = { id: string; text: string };
type Action = { kind: 'add'; todo: Todo } | { kind: 'remove'; id: string };

const todoLoader = defineLoader<Todo[]>(async () => []);

const reducer = (base: Todo[], action: Action): Todo[] => {
  if (action.kind === 'add') return [...base, action.todo];
  return base.filter((t) => t.id !== action.id);
};

function DataReader() {
  const ctx = useContext(LoaderDataContext);
  const data = ctx && 'data' in ctx ? ctx.data : undefined;
  return <pre data-testid="out">{JSON.stringify(data)}</pre>;
}

describe('<OptimisticOverlay>', () => {
  it('passes base data through unchanged when pending is empty', () => {
    const base: Todo[] = [{ id: 'a', text: 'first' }];
    const { getByTestId } = render(
      <LoaderDataContext.Provider value={{ status: 'success', data: base }}>
        <OptimisticOverlay loader={todoLoader} reducer={reducer}>
          <DataReader />
        </OptimisticOverlay>
      </LoaderDataContext.Provider>
    );
    expect(getByTestId('out').textContent).toBe(JSON.stringify(base));
  });

  it('projects pending actions over base via the reducer', () => {
    const base: Todo[] = [{ id: 'a', text: 'first' }];
    const pending: Action[] = [
      { kind: 'add', todo: { id: 'b', text: 'second' } },
      { kind: 'add', todo: { id: 'c', text: 'third' } },
    ];
    const { getByTestId } = render(
      <LoaderDataContext.Provider value={{ status: 'success', data: base }}>
        <OptimisticOverlay
          loader={todoLoader}
          reducer={reducer}
          pending={pending}
        >
          <DataReader />
        </OptimisticOverlay>
      </LoaderDataContext.Provider>
    );
    const projected: Todo[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
      { id: 'c', text: 'third' },
    ];
    expect(getByTestId('out').textContent).toBe(JSON.stringify(projected));
  });

  it('applies pending actions in insertion order', () => {
    const base: Todo[] = [{ id: 'a', text: 'first' }];
    const pending: Action[] = [
      { kind: 'add', todo: { id: 'b', text: 'second' } },
      { kind: 'remove', id: 'a' },
    ];
    const { getByTestId } = render(
      <LoaderDataContext.Provider value={{ status: 'success', data: base }}>
        <OptimisticOverlay
          loader={todoLoader}
          reducer={reducer}
          pending={pending}
        >
          <DataReader />
        </OptimisticOverlay>
      </LoaderDataContext.Provider>
    );
    const projected: Todo[] = [{ id: 'b', text: 'second' }];
    expect(getByTestId('out').textContent).toBe(JSON.stringify(projected));
  });

  it('does not mutate the base array', () => {
    const base: Todo[] = [{ id: 'a', text: 'first' }];
    const baseSnapshot = JSON.stringify(base);
    const pending: Action[] = [
      { kind: 'add', todo: { id: 'b', text: 'second' } },
    ];
    render(
      <LoaderDataContext.Provider value={{ status: 'success', data: base }}>
        <OptimisticOverlay
          loader={todoLoader}
          reducer={reducer}
          pending={pending}
        >
          <DataReader />
        </OptimisticOverlay>
      </LoaderDataContext.Provider>
    );
    expect(JSON.stringify(base)).toBe(baseSnapshot);
  });

  it('projects pending over an absent base during the first (pre-data) load', () => {
    // A cold `loading` arm carries no `data`. The overlay must still surface the
    // optimistic projection so descendants reading `useData()` see the pending
    // items DURING the first load (parity with the pre-state-machine overlay,
    // which always projected), rather than the bare `loading` arm. The reducer
    // tolerates an absent base; the overlay never builds an invalid value itself.
    const tolerantReducer = (
      base: Todo[] | undefined,
      action: Action
    ): Todo[] => {
      const arr = base ?? [];
      if (action.kind === 'add') return [...arr, action.todo];
      return arr.filter((t) => t.id !== action.id);
    };
    const pending: Action[] = [
      { kind: 'add', todo: { id: 'b', text: 'second' } },
    ];
    const { getByTestId } = render(
      <LoaderDataContext.Provider value={{ status: 'loading' }}>
        <OptimisticOverlay
          loader={todoLoader}
          reducer={tolerantReducer}
          pending={pending}
        >
          <DataReader />
        </OptimisticOverlay>
      </LoaderDataContext.Provider>
    );
    expect(getByTestId('out').textContent).toBe(
      JSON.stringify([{ id: 'b', text: 'second' }])
    );
  });

  it('passes the loading arm through unchanged when there is nothing pending', () => {
    // No data AND no pending actions: there is nothing to project, so the
    // genuine cold `loading` arm must pass through (no data leaks onto context).
    const { getByTestId } = render(
      <LoaderDataContext.Provider value={{ status: 'loading' }}>
        <OptimisticOverlay loader={todoLoader} reducer={reducer}>
          <DataReader />
        </OptimisticOverlay>
      </LoaderDataContext.Provider>
    );
    // `'data' in ctx` is false on the loading arm, so DataReader emits no data.
    expect(getByTestId('out').textContent).toBe('');
  });

  it('throws if rendered outside a LoaderDataContext provider', () => {
    expect(() =>
      render(
        <OptimisticOverlay loader={todoLoader} reducer={reducer}>
          <DataReader />
        </OptimisticOverlay>
      )
    ).toThrow(/must be inside a route page that has a loader/);
  });
});
