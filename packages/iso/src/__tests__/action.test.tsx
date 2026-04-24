// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';

describe('defineAction', () => {
  it('returns the function unchanged at runtime', () => {
    const fn = async (_ctx: unknown, _payload: { name: string }) => ({ ok: true });
    const stub = defineAction(fn);
    expect(stub).toBe(fn as unknown);
  });
});

import { render, screen, act, cleanup, waitFor } from '@testing-library/preact';
import { afterEach, vi } from 'vitest';
import { useAction } from '../action.js';
import { ReloadContext } from '../page.js';
import type { ActionStub } from '../action.js';

const stub: ActionStub<{ title: string }, { ok: boolean }> = {
  __module: 'movies',
  __action: 'create',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAction', () => {
  it('sets pending true during fetch and false after', async () => {
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

    let capturedPending: boolean[] = [];
    function TestComponent() {
      const { mutate, pending } = useAction(stub);
      capturedPending.push(pending);
      return (
        <button onClick={() => mutate({ title: 'Dune' })}>go</button>
      );
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(capturedPending).toContain(true);

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    });
    await waitFor(() => expect(capturedPending.at(-1)).toBe(false));
  });

  it('posts the correct JSON body to /__actions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    function TestComponent() {
      const { mutate } = useAction(stub);
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(fetchMock).toHaveBeenCalledWith('/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'movies', action: 'create', payload: { title: 'Dune' } }),
    });
  });

  it('sets data on success and calls onSuccess', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );
    const onSuccess = vi.fn();

    function TestComponent() {
      const { mutate, data } = useAction(stub, { onSuccess });
      return (
        <div>
          <button onClick={() => mutate({ title: 'Dune' })}>go</button>
          <span data-testid="data">{data ? 'has-data' : 'no-data'}</span>
        </div>
      );
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('has-data');
    expect(screen.getByTestId('data')).toHaveTextContent('has-data');
    expect(onSuccess).toHaveBeenCalledWith({ ok: true });
  });

  it('sets error on failure and calls onError with snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'DB error' }), { status: 500 })
      )
    );
    const onMutate = vi.fn(() => 'snapshot-value');
    const onError = vi.fn();

    function TestComponent() {
      const { mutate, error } = useAction(stub, { onMutate, onError });
      return (
        <div>
          <button onClick={() => mutate({ title: 'Dune' })}>go</button>
          <span data-testid="error">{error?.message ?? 'none'}</span>
        </div>
      );
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('DB error');
    expect(screen.getByTestId('error')).toHaveTextContent('DB error');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'snapshot-value');
  });

  it('calls reload when invalidate is "auto"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );
    const reload = vi.fn();

    function TestComponent() {
      const { mutate } = useAction(stub, { invalidate: 'auto' });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(
      <ReloadContext.Provider value={{ reload, reloading: false, error: null }}>
        <TestComponent />
      </ReloadContext.Provider>
    );
    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('does not call reload when invalidate is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    );
    const reload = vi.fn();

    function TestComponent() {
      const { mutate } = useAction(stub, { invalidate: false });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(
      <ReloadContext.Provider value={{ reload, reloading: false, error: null }}>
        <TestComponent />
      </ReloadContext.Provider>
    );
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(reload).not.toHaveBeenCalled();
  });
});
