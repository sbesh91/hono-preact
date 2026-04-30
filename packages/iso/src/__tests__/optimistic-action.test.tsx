// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/preact';
import { useOptimisticAction } from '../optimistic-action.js';
import { ReloadContext } from '../reload-context.js';
import type { ActionStub } from '../action.js';
import { cacheRegistry } from '../cache-registry.js';

const stub: ActionStub<{ title: string }, { id: number; title: string }> = {
  __module: 'movies',
  __action: 'create',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  cacheRegistry.clear();
});

describe('useOptimisticAction', () => {
  it('shows optimistic value while mutation is in flight', async () => {
    let resolveFetch!: (v: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolveFetch = r;
          })
      )
    );

    function TestComponent({ base }: { base: string[] }) {
      const { mutate, value } = useOptimisticAction(stub, {
        base,
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
      });
      return (
        <div>
          <button onClick={() => mutate({ title: 'Dune' })}>go</button>
          <ul data-testid="list">
            {value.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      );
    }

    render(<TestComponent base={['Alien']} />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).toHaveTextContent('Dune');

    // Cleanup the in-flight fetch so the test can finish
    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ id: 1, title: 'Dune' }), { status: 200 })
      );
    });
  });

  it('reverts to base on mutation failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'DB error' }), { status: 500 })
      )
    );

    function TestComponent() {
      const { mutate, value, error } = useOptimisticAction(stub, {
        base: ['Alien'],
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
      });
      return (
        <div>
          <button onClick={() => mutate({ title: 'Dune' })}>go</button>
          <ul data-testid="list">
            {value.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <span data-testid="err">{error?.message ?? 'none'}</span>
        </div>
      );
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('DB error');
    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).not.toHaveTextContent('Dune');
  });

  it('calls user-supplied onSuccess(data) without exposing snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1, title: 'Dune' }), { status: 200 })
      )
    );
    const onSuccess = vi.fn();

    function TestComponent() {
      const { mutate } = useOptimisticAction(stub, {
        base: ['Alien'],
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
        onSuccess,
      });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(
      <ReloadContext.Provider value={{ reload: vi.fn(), reloading: false, error: null }}>
        <TestComponent />
      </ReloadContext.Provider>
    );
    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith({ id: 1, title: 'Dune' });
    // Verify only one argument was passed (no snapshot leak)
    expect(onSuccess.mock.calls[0]).toHaveLength(1);
  });

  it('calls user-supplied onError(err) without exposing snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'DB error' }), { status: 500 })
      )
    );
    const onError = vi.fn();

    function TestComponent() {
      const { mutate } = useOptimisticAction(stub, {
        base: ['Alien'],
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
        onError,
      });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0]).toHaveLength(1);
  });

  it('handles concurrent mutations: first settles, second still optimistic', async () => {
    const resolvers: Array<(v: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolvers.push(r);
          })
      )
    );

    function TestComponent({ base }: { base: string[] }) {
      const { mutate, value } = useOptimisticAction(stub, {
        base,
        apply: (current, payload) => [...current, payload.title],
        invalidate: 'auto',
      });
      return (
        <div>
          <button data-testid="add-a" onClick={() => mutate({ title: 'A' })}>
            A
          </button>
          <button data-testid="add-b" onClick={() => mutate({ title: 'B' })}>
            B
          </button>
          <ul data-testid="list">
            {value.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      );
    }

    const { rerender } = render(<TestComponent base={['Alien']} />);

    await act(async () => {
      screen.getByTestId('add-a').click();
    });
    await act(async () => {
      screen.getByTestId('add-b').click();
    });

    // Both optimistic
    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).toHaveTextContent('A');
    expect(screen.getByTestId('list')).toHaveTextContent('B');

    // Resolve A
    await act(async () => {
      resolvers[0]!(
        new Response(JSON.stringify({ id: 1, title: 'A' }), { status: 200 })
      );
    });

    // Simulate the loader refetch by rerendering with a new base reference (A confirmed)
    rerender(<TestComponent base={['Alien', 'A']} />);

    // A is now from base (server-confirmed); B is still optimistic
    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).toHaveTextContent('A');
    expect(screen.getByTestId('list')).toHaveTextContent('B');

    // Resolve B
    await act(async () => {
      resolvers[1]!(
        new Response(JSON.stringify({ id: 2, title: 'B' }), { status: 200 })
      );
    });

    // Refetch reflects both
    rerender(<TestComponent base={['Alien', 'A', 'B']} />);
    expect(screen.getByTestId('list')).toHaveTextContent('Alien');
    expect(screen.getByTestId('list')).toHaveTextContent('A');
    expect(screen.getByTestId('list')).toHaveTextContent('B');
  });
});
