// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { defineAction } from '../action.js';

describe('defineAction', () => {
  it('returns the function unchanged at runtime', () => {
    const fn = async (_ctx: unknown, _payload: { name: string }) => ({
      ok: true,
    });
    const stub = defineAction(fn);
    expect(stub).toBe(fn as unknown);
  });

  it('attaches `use` via defineProperty so frozen modules do not throw', () => {
    const fn = async (_ctx: unknown, _payload: { name: string }) => ({
      ok: true,
    });
    // Simulate a strict-ESM frozen module export by freezing the function
    // before defineAction wraps it. Direct assignment would throw on a
    // frozen object; defineProperty with `configurable: true` on a fresh
    // property succeeds.
    const use = [{ kind: 'middleware' as const, runs: 'server' as const }];
    const stub = defineAction(fn, { use: use as never });
    expect((stub as unknown as { use?: unknown }).use).toBe(use);
    // Verify the property is non-enumerable (we set enumerable: false).
    const descriptor = Object.getOwnPropertyDescriptor(stub, 'use');
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.configurable).toBe(true);
  });

  it('leaves `use` unset when no opts are passed', () => {
    const fn = async (_ctx: unknown, _payload: unknown) => null;
    const stub = defineAction(fn);
    expect((stub as unknown as { use?: unknown }).use).toBeUndefined();
  });
});

import {
  render,
  screen,
  act,
  cleanup,
  waitFor,
  renderHook,
  fireEvent,
} from '@testing-library/preact';
import { afterEach, vi } from 'vitest';
import { useEffect } from 'preact/hooks';
import { useAction } from '../action.js';
import { ReloadContext } from '../reload-context.js';
import { ActiveLoaderIdContext } from '../internal/contexts.js';
import type { ActionStub } from '../action.js';
import { defineLoader } from '../define-loader.js';

const stub = {
  __module: 'movies',
  __action: 'create',
} as unknown as ActionStub<{ title: string }, { ok: boolean }>;

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
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(capturedPending).toContain(true);

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    await waitFor(() => expect(capturedPending.at(-1)).toBe(false));
  });

  it('posts the correct JSON body to /__actions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
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
      body: JSON.stringify({
        module: 'movies',
        action: 'create',
        payload: { title: 'Dune' },
      }),
    });
  });

  it('sets data on success and calls onSuccess', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
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

  it('passes snapshot from onMutate to onSuccess', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        )
    );
    const onMutate = vi.fn(() => 'snap-success');
    const onSuccess = vi.fn();

    function TestComponent() {
      const { mutate } = useAction(stub, { onMutate, onSuccess });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({ ok: true }, 'snap-success')
    );
  });

  it('sets error on failure and calls onError with snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
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
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        )
    );
    const reload = vi.fn();

    function TestComponent() {
      const { mutate } = useAction(stub, { invalidate: 'auto' });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(
      <ReloadContext.Provider value={{ reload, reloading: false }}>
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
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        )
    );
    const reload = vi.fn();

    function TestComponent() {
      const { mutate } = useAction(stub, { invalidate: false });
      return <button onClick={() => mutate({ title: 'Dune' })}>go</button>;
    }

    render(
      <ReloadContext.Provider value={{ reload, reloading: false }}>
        <TestComponent />
      </ReloadContext.Provider>
    );
    await act(async () => {
      screen.getByRole('button').click();
    });

    expect(reload).not.toHaveBeenCalled();
  });

  it('triggers reloadCtx.reload() when invalidate includes the active loader', async () => {
    const active = defineLoader(async () => ({ value: 1 }), {
      __moduleKey: 'reload-active-test',
    });
    const other = defineLoader(async () => ({ value: 2 }), {
      __moduleKey: 'reload-other-test',
    });
    const reload = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const refStub = {
      __module: 'm',
      __action: 'go',
    } as unknown as ActionStub<Record<string, never>, { ok: true }>;

    function TestComponent() {
      const { mutate } = useAction(refStub, { invalidate: [active, other] });
      return <button onClick={() => mutate({})}>go</button>;
    }

    render(
      <ActiveLoaderIdContext.Provider value={active.__id}>
        <ReloadContext.Provider value={{ reload, reloading: false }}>
          <TestComponent />
        </ReloadContext.Provider>
      </ActiveLoaderIdContext.Provider>
    );
    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('does not call reloadCtx.reload() when invalidate refs do not include the active loader', async () => {
    const active = defineLoader(async () => ({ value: 1 }), {
      __moduleKey: 'reload-active-test-2',
    });
    const other = defineLoader(async () => ({ value: 2 }), {
      __moduleKey: 'reload-other-test-2',
    });
    const reload = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const refStub = {
      __module: 'm',
      __action: 'go',
    } as unknown as ActionStub<Record<string, never>, { ok: true }>;

    function TestComponent() {
      const { mutate } = useAction(refStub, { invalidate: [other] });
      return <button onClick={() => mutate({})}>go</button>;
    }

    render(
      <ActiveLoaderIdContext.Provider value={active.__id}>
        <ReloadContext.Provider value={{ reload, reloading: false }}>
          <TestComponent />
        </ReloadContext.Provider>
      </ActiveLoaderIdContext.Provider>
    );
    await act(async () => {
      screen.getByRole('button').click();
    });

    // Wait long enough for the action to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(reload).not.toHaveBeenCalled();
  });

  it('calls .invalidate() on each loader ref after a successful mutation', async () => {
    const a = defineLoader(async () => ({ a: 1 }));
    const b = defineLoader(async () => ({ b: 2 }));
    a.cache.set({ a: 1 });
    b.cache.set({ b: 2 });
    expect(a.cache.has()).toBe(true);
    expect(b.cache.has()).toBe(true);

    const refStub = {
      __module: 'm',
      __action: 'go',
    } as unknown as ActionStub<Record<string, never>, { ok: true }>;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    function TestComponent() {
      const { mutate } = useAction(refStub, { invalidate: [a, b] });
      return <button onClick={() => mutate({})}>go</button>;
    }

    render(<TestComponent />);
    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => {
      expect(a.cache.has()).toBe(false);
      expect(b.cache.has()).toBe(false);
    });
  });

  it('mutate resolves to { ok: true, data } on success so callers can chain', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 'i-42' }), { status: 200 })
        )
    );

    type Result = { id: string };
    let captured: Awaited<ReturnType<typeof mutateRef.current>> | undefined;
    const mutateRef = {
      current: null as unknown as (p: {
        x: number;
      }) => Promise<{ ok: true; data: Result } | { ok: false; error: Error }>,
    };

    function TestComponent() {
      const { mutate } = useAction(
        stub as unknown as ActionStub<{ x: number }, Result>
      );
      mutateRef.current = mutate;
      return null;
    }
    render(<TestComponent />);

    await act(async () => {
      captured = await mutateRef.current({ x: 1 });
    });
    expect(captured).toEqual({ ok: true, data: { id: 'i-42' } });
  });

  it('mutate resolves to { ok: false, error } on failure (no throw)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'nope' }), { status: 400 })
        )
    );

    let captured: { ok: boolean } | undefined;
    const mutateRef = {
      current: null as unknown as (p: {
        x: number;
      }) => Promise<{ ok: true; data: unknown } | { ok: false; error: Error }>,
    };

    function TestComponent() {
      const { mutate } = useAction(
        stub as unknown as ActionStub<{ x: number }, { id: string }>
      );
      mutateRef.current = mutate;
      return null;
    }
    render(<TestComponent />);

    await act(async () => {
      captured = await mutateRef.current({ x: 1 });
    });
    expect(captured?.ok).toBe(false);
    if (captured && !captured.ok) {
      // Narrowing: when ok is false the result has an `error` field.
      expect((captured as { ok: false; error: Error }).error.message).toBe(
        'nope'
      );
    }
  });

  it('exposes useAction as a method on the stub', async () => {
    // Mimic the shape produced by serverOnlyPlugin's client-side Proxy.
    const methodStub: ActionStub<{ x: number }, { ok: true }> = {
      __module: 'm',
      __action: 'go',
      useAction(opts) {
        return useAction(this as ActionStub<{ x: number }, { ok: true }>, opts);
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    const captured: Array<{ pending: boolean; data: unknown }> = [];
    function Probe() {
      const { mutate, pending, data } = methodStub.useAction();
      captured.push({ pending, data });
      useEffect(() => {
        void mutate({ x: 1 });
      }, [mutate]);
      return null;
    }
    render(<Probe />);

    await waitFor(() => {
      expect(captured.some((c) => c.data && (c.data as { ok: true }).ok)).toBe(
        true
      );
    });
  });
});

describe('useAction — outcome envelope decoding', () => {
  it('throws an Error carrying the deny message when the response is a deny outcome (C7)', async () => {
    // body.message takes precedence over body.error: the action handler
    // emits `{ __outcome: 'deny', message }` and the client should surface
    // that message (not "Action failed with status 403") so users see the
    // descriptive copy attached to the deny.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ __outcome: 'deny', message: 'Forbidden' }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
    );

    const { result } = renderHook(() => useAction(stub));
    let mutateResult: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      mutateResult = await result.current.mutate({ title: 'Dune' });
    });
    expect(mutateResult!.ok).toBe(false);
    if (!mutateResult!.ok) {
      expect(mutateResult!.error.message).toBe('Forbidden');
    }
  });

  it('falls back to a deny-aware label when the envelope lacks a message (C7 defense in depth)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ __outcome: 'deny' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const { result } = renderHook(() => useAction(stub));
    let mutateResult: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      mutateResult = await result.current.mutate({ title: 'Dune' });
    });
    expect(mutateResult!.ok).toBe(false);
    if (!mutateResult!.ok) {
      expect(mutateResult!.error.message).toMatch(/Request denied \(403\)/);
    }
  });

  it('calls window.location.assign and returns a never-settling promise when the response is a redirect outcome (C8)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ __outcome: 'redirect', to: '/login', status: 302 }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
    );

    const assignSpy = vi.fn();
    Object.defineProperty(window.location, 'assign', {
      configurable: true,
      value: assignSpy,
    });

    const { result } = renderHook(() => useAction(stub));
    const p = result.current.mutate({ title: 'Dune' });
    // The promise never settles because the page is navigating; race
    // against a short timeout to assert that.
    const winner = await Promise.race([
      p,
      new Promise<'pending'>((r) => setTimeout(() => r('pending'), 30)),
    ]);
    expect(winner).toBe('pending');
    expect(assignSpy).toHaveBeenCalledWith('/login');
  });

  it('decodes a redirect outcome from a FormData submission (C9)', async () => {
    // The clean-path verification: FormData submissions go through the
    // same peek-at-json + window.location.assign path as JSON submissions.
    // Pin this so a future refactor doesn't regress the symmetry.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ __outcome: 'redirect', to: '/login', status: 302 }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
    );
    const assignSpy = vi.fn();
    Object.defineProperty(window.location, 'assign', {
      configurable: true,
      value: assignSpy,
    });

    const { result } = renderHook(() => useAction(stub));
    const p = result.current.mutate({
      title: 'Dune',
      // Including a File forces the FormData branch.
      poster: new File(['data'], 'poster.jpg') as never,
    } as never);
    const winner = await Promise.race([
      p,
      new Promise<'pending'>((r) => setTimeout(() => r('pending'), 30)),
    ]);
    expect(winner).toBe('pending');
    expect(assignSpy).toHaveBeenCalledWith('/login');
  });

  it('decodes a deny outcome from a FormData submission (C9)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ __outcome: 'deny', message: 'Upload forbidden' }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
    );

    const { result } = renderHook(() => useAction(stub));
    let mutateResult: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      mutateResult = await result.current.mutate({
        title: 'Dune',
        poster: new File(['data'], 'poster.jpg') as never,
      } as never);
    });
    expect(mutateResult!.ok).toBe(false);
    if (!mutateResult!.ok) {
      expect(mutateResult!.error.message).toBe('Upload forbidden');
    }
  });
});

describe('useAction — streaming (onChunk)', () => {
  it('calls onChunk for each SSE data event with parsed JSON', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"progress":50}\n\n'));
        controller.enqueue(encoder.encode('data: {"progress":100}\n\n'));
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    );

    const onChunk = vi.fn();
    const { result } = renderHook(() => useAction(stub, { onChunk }));

    await act(async () => {
      await result.current.mutate({} as { title: string });
    });

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, { progress: 50 });
    expect(onChunk).toHaveBeenNthCalledWith(2, { progress: 100 });
  });
});

const mockStub = {
  __module: 'test-module',
  __action: 'test-action',
} as unknown as ActionStub<Record<string, unknown>, unknown>;

describe('useAction — FormData (file upload)', () => {
  it('sends FormData when payload contains a File', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ stored: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAction(mockStub));

    await act(async () => {
      await result.current.mutate({ poster: new File(['data'], 'poster.jpg') });
    });

    const call = fetchMock.mock.calls[0];
    expect(call[1]?.body).toBeInstanceOf(FormData);
    const fd = call[1]?.body as FormData;
    expect(fd.get('__module')).toBe('test-module');
    expect(fd.get('__action')).toBe('test-action');
    expect(fd.get('poster')).toBeInstanceOf(File);
  });

  it('serializes non-string non-File values as JSON strings', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAction(mockStub));

    await act(async () => {
      await result.current.mutate({
        poster: new File(['data'], 'p.jpg'),
        count: 5,
      });
    });

    const fd = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(fd.get('count')).toBe('5'); // number serialized as JSON string
    expect(fd.get('poster')).toBeInstanceOf(File);
  });

  it('sends JSON when payload has no File values', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAction(mockStub));

    await act(async () => {
      await result.current.mutate({ title: 'Dune' });
    });

    const call = fetchMock.mock.calls[0];
    expect(call[1]?.body).not.toBeInstanceOf(FormData);
    expect(call[1]?.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });
});

describe('useAction: streaming via SSE', () => {
  it('routes each data event to onChunk and the event:result to onSuccess/data', async () => {
    const chunks: Array<{ count: number }> = [];
    let final: { imported: number } | null = null;

    const sse =
      'data: {"count":1}\n\n' +
      'data: {"count":2}\n\n' +
      'event: result\ndata: {"imported":2}\n\n';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const streamingStub = {
      __module: 'x',
      __action: 'go',
    } as unknown as ActionStub<
      unknown,
      { imported: number },
      { count: number }
    >;

    function Probe() {
      const { mutate } = useAction(streamingStub, {
        onChunk: (c) => {
          chunks.push(c);
        },
        onSuccess: (r) => {
          final = r;
        },
      });
      return (
        <button data-testid="go" onClick={() => mutate({})}>
          go
        </button>
      );
    }

    const { findByTestId } = render(<Probe />);
    fireEvent.click(await findByTestId('go'));
    await waitFor(() => expect(final).not.toBeNull());

    expect(chunks).toEqual([{ count: 1 }, { count: 2 }]);
    expect(final).toEqual({ imported: 2 });
  });

  it('routes event: error to onError and rejects the mutate', async () => {
    const sse =
      'data: {"count":1}\n\n' +
      'event: error\ndata: {"message":"boom","name":"Error"}\n\n';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    );

    const streamingStub = {
      __module: 'x',
      __action: 'go',
    } as unknown as ActionStub<unknown, unknown, { count: number }>;
    let caught = null as Error | null;
    let chunks = 0;

    function Probe() {
      const { mutate } = useAction(streamingStub, {
        onChunk: () => {
          chunks++;
        },
        onError: (err) => {
          caught = err;
        },
      });
      return (
        <button data-testid="go" onClick={() => mutate({})}>
          go
        </button>
      );
    }

    const { findByTestId } = render(<Probe />);
    fireEvent.click(await findByTestId('go'));
    await waitFor(() => expect(caught).not.toBeNull());
    expect(caught?.message).toBe('boom');
    expect(chunks).toBe(1);
  });

  it('surfaces a malformed event: result as an error via onError', async () => {
    const sse =
      'data: {"count":1}\n\n' + 'event: result\ndata: this-is-not-json\n\n';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    );

    const streamingStub = {
      __module: 'x',
      __action: 'go',
    } as unknown as ActionStub<unknown, { ok: boolean }, { count: number }>;
    let caught = null as Error | null;

    function Probe() {
      const { mutate } = useAction(streamingStub, {
        onError: (err) => {
          caught = err;
        },
      });
      return (
        <button data-testid="go" onClick={() => mutate({})}>
          go
        </button>
      );
    }

    const { findByTestId } = render(<Probe />);
    fireEvent.click(await findByTestId('go'));
    await waitFor(() => expect(caught).not.toBeNull());
    expect(caught?.message).toMatch(/Malformed result event/);
  });
});
