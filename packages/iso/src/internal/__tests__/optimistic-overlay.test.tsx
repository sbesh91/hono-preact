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
  return <pre data-testid="out">{JSON.stringify(ctx?.data)}</pre>;
}

describe('<OptimisticOverlay>', () => {
  it('passes base data through unchanged when pending is empty', () => {
    const base: Todo[] = [{ id: 'a', text: 'first' }];
    const { getByTestId } = render(
      <LoaderDataContext.Provider value={{ data: base }}>
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
      <LoaderDataContext.Provider value={{ data: base }}>
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
      <LoaderDataContext.Provider value={{ data: base }}>
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
      <LoaderDataContext.Provider value={{ data: base }}>
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
