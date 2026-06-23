import { describe, it, expect, vi } from 'vitest';
import {
  makeCfPubSubBackend,
  runWithRealtimeRuntime,
  getRealtimeRuntime,
  type RealtimeRuntime,
} from '../cf-pubsub.js';

// A fake hibernation-style WebSocket the fake DO stub hands back on a topic
// upgrade. The backend calls .accept() then listens for 'message'.
function fakeWs() {
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  return {
    accepted: false,
    closed: false,
    accept() {
      this.accepted = true;
    },
    addEventListener(type: string, cb: (ev: unknown) => void) {
      (listeners[type] ??= []).push(cb);
    },
    close() {
      this.closed = true;
    },
    // test helpers: drive each event type independently (a 'message' emit must
    // NOT trip the close/error listeners).
    _emit(data: unknown) {
      for (const cb of listeners['message'] ?? []) cb({ data });
    },
    _close() {
      for (const cb of listeners['close'] ?? []) cb({});
    },
    _error() {
      for (const cb of listeners['error'] ?? []) cb({});
    },
  };
}

// A fake DurableObjectNamespace recording every stub.fetch and returning a
// fake socket for topic upgrades / a 204 for publishes.
function fakeNamespace() {
  const fetches: Array<{ topic: string; url: string; init?: RequestInit }> = [];
  const wsByTopic = new Map<string, ReturnType<typeof fakeWs>>();
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: (url: string, init?: RequestInit) => {
        fetches.push({ topic: id.name, url, init });
        const kind = (init?.headers as Record<string, string> | undefined)?.[
          'x-hp-kind'
        ];
        if (kind === 'topic') {
          const ws = fakeWs();
          wsByTopic.set(id.name, ws);
          return Promise.resolve({ webSocket: ws } as unknown as Response);
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    }),
  };
  return { ns, fetches, wsByTopic };
}

function runtimeWith(ns: unknown): RealtimeRuntime {
  return {
    env: { HONO_PREACT_REALTIME: ns },
    ctx: { waitUntil: vi.fn() },
  } as unknown as RealtimeRuntime;
}

describe('makeCfPubSubBackend', () => {
  it('subscribe opens an x-hp-kind:topic upgrade, accepts, and forwards parsed DO frames', async () => {
    const { ns, fetches, wsByTopic } = fakeNamespace();
    const backend = makeCfPubSubBackend(() => runtimeWith(ns));
    const received: unknown[] = [];

    const unsub = backend.subscribe('counter', (m) => received.push(m));
    await Promise.resolve(); // let the async upgrade resolve

    expect(fetches).toHaveLength(1);
    expect(fetches[0]!.topic).toBe('counter');
    const headers = fetches[0]!.init!.headers as Record<string, string>;
    expect(headers['x-hp-kind']).toBe('topic');
    expect(headers['Upgrade']).toBe('websocket');
    const ws = wsByTopic.get('counter')!;
    expect(ws.accepted).toBe(true);

    ws._emit(JSON.stringify({ count: 7 }));
    expect(received).toEqual([{ count: 7 }]);

    unsub();
    // The unsub close waits for `opening` to settle; drain microtasks fully.
    await new Promise<void>((r) => setTimeout(r));
    expect(ws.closed).toBe(true);
  });

  it('publish POSTs the message x-hp-kind:publish and holds it with waitUntil', async () => {
    const { ns, fetches } = fakeNamespace();
    const rt = runtimeWith(ns);
    const backend = makeCfPubSubBackend(() => rt);

    backend.publish('counter', { count: 1 });
    await Promise.resolve();

    expect(fetches).toHaveLength(1);
    expect(fetches[0]!.topic).toBe('counter');
    expect(fetches[0]!.init!.method).toBe('POST');
    expect(
      (fetches[0]!.init!.headers as Record<string, string>)['x-hp-kind']
    ).toBe('publish');
    expect(fetches[0]!.init!.body).toBe(JSON.stringify({ count: 1 }));
    expect(rt.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it('throws a clear setup error when the binding is missing', () => {
    const backend = makeCfPubSubBackend(() => undefined);
    expect(() => backend.publish('counter', {})).toThrow(
      /require the HONO_PREACT_REALTIME Durable Object binding/
    );
  });

  it('honors a custom binding name', () => {
    const { ns } = fakeNamespace();
    const rt = {
      env: { MY_RT: ns },
      ctx: { waitUntil: vi.fn() },
    } as unknown as RealtimeRuntime;
    const backend = makeCfPubSubBackend(() => rt, 'MY_RT');
    expect(() => backend.publish('counter', {})).not.toThrow();
  });

  it('unsub before the upgrade resolves closes the DO socket (no leak)', async () => {
    const { ns, wsByTopic } = fakeNamespace();
    const backend = makeCfPubSubBackend(() => runtimeWith(ns));

    const unsub = backend.subscribe('counter', () => {});
    unsub(); // before the async upgrade resolves
    await new Promise<void>((r) => setTimeout(r));

    const ws = wsByTopic.get('counter')!;
    // The DO accepts the server end synchronously (before the 101); closing this
    // end evicts it from getWebSockets('topic') instead of leaking it for the
    // DO's lifetime. Before the fix the closed branch returned without closing.
    expect(ws.closed).toBe(true);
    expect(ws.accepted).toBe(false); // bailed before accept()
  });

  it('a mid-life socket close surfaces onError exactly once', async () => {
    const { ns, wsByTopic } = fakeNamespace();
    const backend = makeCfPubSubBackend(() => runtimeWith(ns));
    const onError = vi.fn();

    backend.subscribe('counter', () => {}, onError);
    await new Promise<void>((r) => setTimeout(r)); // let the upgrade open
    const ws = wsByTopic.get('counter')!;
    expect(ws.accepted).toBe(true);

    ws._close();
    ws._error(); // a follow-on event must not double-report
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a close triggered by our own unsub is not reported as an error', async () => {
    const { ns, wsByTopic } = fakeNamespace();
    const backend = makeCfPubSubBackend(() => runtimeWith(ns));
    const onError = vi.fn();

    const unsub = backend.subscribe('counter', () => {}, onError);
    await new Promise<void>((r) => setTimeout(r));
    unsub();
    await new Promise<void>((r) => setTimeout(r));
    // The unsub closed the socket; that close event must not look like a failure.
    wsByTopic.get('counter')!._close();
    expect(onError).not.toHaveBeenCalled();
  });

  it('an open failure (DO returns no WebSocket) surfaces onError', async () => {
    const badNs = {
      idFromName: (name: string) => ({ name }),
      get: () => ({
        fetch: () => Promise.resolve({} as unknown as Response), // no .webSocket
      }),
    };
    const rt = {
      env: { HONO_PREACT_REALTIME: badNs },
      ctx: { waitUntil: vi.fn() },
    } as unknown as RealtimeRuntime;
    const backend = makeCfPubSubBackend(() => rt);
    const onError = vi.fn();

    backend.subscribe('counter', () => {}, onError);
    await new Promise<void>((r) => setTimeout(r));
    // The no-webSocket throw inside onFulfilled is folded in by the trailing
    // .catch (the old two-arg .then form would have lost it) and surfaced.
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('runWithRealtimeRuntime scopes the runtime to the async context', () => {
    const env = { HONO_PREACT_REALTIME: {} };
    const ctx = { waitUntil: vi.fn() };

    // Outside any run scope, there is no captured runtime.
    expect(getRealtimeRuntime()).toBeUndefined();

    const inside = runWithRealtimeRuntime(env, ctx, () => {
      // Inside the scope, the deep getRealtimeRuntime() reads THIS run's runtime.
      expect(getRealtimeRuntime()).toEqual({ env, ctx });
      return 'result';
    });

    // The callback's return value passes through (the entry returns coreApp.fetch).
    expect(inside).toBe('result');
    // The scope does not leak: outside the run, the store is empty again.
    expect(getRealtimeRuntime()).toBeUndefined();
  });

  it('isolates the runtime across overlapping (interleaved) request scopes', async () => {
    // The bug this replaces: a module global would let request B overwrite A's
    // runtime. With ALS, A's deferred read inside its own run sees A's runtime
    // even though B's run interleaves first.
    const ctxA = { waitUntil: vi.fn() };
    const ctxB = { waitUntil: vi.fn() };
    const seen: Array<{ ctx: unknown } | undefined> = [];

    const a = runWithRealtimeRuntime({ tag: 'A' }, ctxA, async () => {
      await Promise.resolve(); // yield: B's run starts during this gap
      seen[0] = getRealtimeRuntime();
    });
    const b = runWithRealtimeRuntime({ tag: 'B' }, ctxB, async () => {
      seen[1] = getRealtimeRuntime();
    });
    await Promise.all([a, b]);

    expect(seen[0]).toEqual({ env: { tag: 'A' }, ctx: ctxA });
    expect(seen[1]).toEqual({ env: { tag: 'B' }, ctx: ctxB });
  });
});
