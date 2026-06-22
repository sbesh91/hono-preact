import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  makeCfPubSubBackend,
  captureRealtimeRuntime,
  getRealtimeRuntime,
  __resetRealtimeRuntimeForTesting,
  type RealtimeRuntime,
} from '../cf-pubsub.js';

// A fake hibernation-style WebSocket the fake DO stub hands back on a topic
// upgrade. The backend calls .accept() then listens for 'message'.
function fakeWs() {
  const listeners: Array<(ev: { data: unknown }) => void> = [];
  return {
    accepted: false,
    closed: false,
    accept() {
      this.accepted = true;
    },
    addEventListener(_type: 'message', cb: (ev: { data: unknown }) => void) {
      listeners.push(cb);
    },
    close() {
      this.closed = true;
    },
    // test helper: simulate a DO -> subscriber frame
    _emit(data: unknown) {
      for (const cb of listeners) cb({ data });
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

afterEach(() => __resetRealtimeRuntimeForTesting());

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
    await Promise.resolve();
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
    expect((fetches[0]!.init!.headers as Record<string, string>)['x-hp-kind']).toBe(
      'publish'
    );
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
    const rt = { env: { MY_RT: ns }, ctx: { waitUntil: vi.fn() } } as unknown as RealtimeRuntime;
    const backend = makeCfPubSubBackend(() => rt, 'MY_RT');
    expect(() => backend.publish('counter', {})).not.toThrow();
  });

  it('captureRealtimeRuntime / getRealtimeRuntime round-trips', () => {
    const env = { HONO_PREACT_REALTIME: {} };
    const ctx = { waitUntil: vi.fn() };
    captureRealtimeRuntime(env, ctx);
    expect(getRealtimeRuntime()).toEqual({ env, ctx });
    __resetRealtimeRuntimeForTesting();
    expect(getRealtimeRuntime()).toBeUndefined();
  });
});
