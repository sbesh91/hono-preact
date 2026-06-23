import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
// Import from the platform-free glue module, NOT realtime-do.ts: the class file
// imports `cloudflare:workers`, which does not resolve in plain vitest (Node).
// The glue holds the connector + the DOConnState adapter (testable without
// workerd); the class itself is covered by the Task 8 workerd integration test.
import {
  makeCfForwardConnector,
  makeDOConnState,
  isTopicSubscriber,
  fanOutToTopicSubscribers,
  isSocketConnection,
  makeServerSocketHandle,
  type RoomConnAttachment,
} from '../realtime-do-glue.js';
import type { RoomForwardContext } from '@hono-preact/iso/internal/runtime';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface ForwardRecord {
  id: string;
  request: Request;
}

/**
 * A fake DurableObjectNamespace whose `get(id).fetch(req)` records the id it was
 * obtained for and the forwarded Request, then returns a sentinel Response. The
 * real Response would be a 101 upgrade, which the WHATWG constructor rejects
 * outside workerd, so the sentinel is a plain 200 (the connector returns
 * whatever `stub.fetch` returns; the test asserts the forwarded request, not the
 * status).
 */
function makeFakeNamespace(records: ForwardRecord[]) {
  const sentinel = new Response('forwarded-to-DO');
  // `idFromName` returns the name itself so the test can assert `idFromName(topic)`
  // was the id the stub was obtained for.
  return {
    sentinel,
    namespace: {
      idFromName: (name: string) => ({ __id: name }),
      get: (id: { __id: string }) => ({
        fetch: (request: Request) => {
          records.push({ id: id.__id, request });
          return sentinel;
        },
      }),
    },
  };
}

/**
 * Build a minimal Hono Context exposing only what the connector reads: `req.raw`
 * (a real Request whose immutable headers force the rebuild path) and `env`. The
 * connector reads the namespace through the injected `getNamespace`, so `env`
 * here is only what that callback closes over.
 */
function makeContext(raw: Request): Context {
  // Test-only structural Context: the connector touches `c.req.raw` only.
  return { req: { raw } } as unknown as Context;
}

// Forward-context fields (the connector's forward path). The `kind` discriminant
// is included so the spread builds a complete RoomForwardContext when paired with
// `c`; the deny path carries no fields beyond `c` and is exercised in the workerd
// integration test (the deny close needs WebSocketPair, a workerd-only global).
function baseCtx(
  overrides: Partial<Omit<RoomForwardContext, 'c'>> = {}
): Omit<RoomForwardContext, 'c'> {
  return {
    kind: 'forward',
    topic: 'room/abc',
    moduleKey: 'src/pages/board.server',
    name: 'board',
    params: { roomId: 'abc' },
    data: { user: 'alice' },
    ...overrides,
  };
}

function upgradeRequest(): Request {
  return new Request('https://example.com/__sockets?m=x', {
    headers: { Upgrade: 'websocket', 'x-existing': 'kept' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('makeCfForwardConnector', () => {
  it('forwards to idFromName(topic) with the x-hp-* context headers set', async () => {
    const records: ForwardRecord[] = [];
    const { namespace, sentinel } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    const raw = upgradeRequest();
    const res = await connector({ c: makeContext(raw), ...baseCtx() });

    // Returns exactly what stub.fetch returned.
    expect(res).toBe(sentinel);

    expect(records).toHaveLength(1);
    const fwd = records[0];
    // One DO per topic: the stub is obtained for idFromName(topic).
    expect(fwd.id).toBe('room/abc');

    // The x-hp-* headers carry the resolved room context.
    expect(fwd.request.headers.get('x-hp-topic')).toBe('room/abc');
    expect(fwd.request.headers.get('x-hp-module')).toBe(
      'src/pages/board.server'
    );
    expect(fwd.request.headers.get('x-hp-name')).toBe('board');
    expect(fwd.request.headers.get('x-hp-params')).toBe(
      JSON.stringify({ roomId: 'abc' })
    );
    expect(fwd.request.headers.get('x-hp-data')).toBe(
      JSON.stringify({ user: 'alice' })
    );
  });

  it('rebuilds the request preserving the original headers (Upgrade, etc.)', async () => {
    const records: ForwardRecord[] = [];
    const { namespace } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    const raw = upgradeRequest();
    await connector({ c: makeContext(raw), ...baseCtx() });

    const fwd = records[0].request;
    // The forwarded request is a fresh Request (rebuilt from c.req.raw), but the
    // original headers carry over (the upgrade intent must survive).
    expect(fwd).not.toBe(raw);
    expect(fwd.headers.get('upgrade')).toBe('websocket');
    expect(fwd.headers.get('x-existing')).toBe('kept');
  });

  it('serializes undefined data as null on the wire', async () => {
    const records: ForwardRecord[] = [];
    const { namespace } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    await connector({
      c: makeContext(upgradeRequest()),
      ...baseCtx({ data: undefined }),
    });

    expect(records[0].request.headers.get('x-hp-data')).toBe('null');
  });

  it('throws a clear binding error when the namespace is missing', async () => {
    const connector = makeCfForwardConnector(() => undefined);
    await expect(
      connector({ c: makeContext(upgradeRequest()), ...baseCtx() })
    ).rejects.toThrow(/HONO_PREACT_REALTIME Durable Object binding/);
  });

  it('rejects an oversized data bag with a clear size-limit error', async () => {
    const records: ForwardRecord[] = [];
    const { namespace } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    // > 6KB once JSON-stringified.
    const huge = 'x'.repeat(7 * 1024);
    await expect(
      connector({
        c: makeContext(upgradeRequest()),
        ...baseCtx({ data: { blob: huge } }),
      })
    ).rejects.toThrow(/exceeds the .* forward limit/);

    // And nothing was forwarded to the DO.
    expect(records).toHaveLength(0);
  });

  it('rejects an oversized params payload too', async () => {
    const records: ForwardRecord[] = [];
    const { namespace } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    const huge = 'y'.repeat(7 * 1024);
    await expect(
      connector({
        c: makeContext(upgradeRequest()),
        ...baseCtx({ params: { roomId: huge } }),
      })
    ).rejects.toThrow(/forward limit/);
    expect(records).toHaveLength(0);
  });

  it('allows a data bag just under the limit', async () => {
    const records: ForwardRecord[] = [];
    const { namespace } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    // ~5KB of payload, comfortably under the 6KB limit after stringify.
    const ok = 'z'.repeat(5 * 1024);
    await connector({
      c: makeContext(upgradeRequest()),
      ...baseCtx({ data: { blob: ok } }),
    });
    expect(records).toHaveLength(1);
  });

  it('strips client-supplied x-hp-kind so the DO always takes the room path', async () => {
    // Regression: the DO dispatches on x-hp-kind (reads it as its first decision).
    // A non-browser client could set x-hp-kind: topic or x-hp-kind: publish on the
    // upgrade request, which would survive into the forwarded Request and divert the
    // room upgrade into the topic-subscribe or publish branch on the room's DO,
    // bypassing the room engine. The connector must delete the inbound header so the
    // server controls DO dispatch (the DO defaults an absent x-hp-kind to 'room').
    const records: ForwardRecord[] = [];
    const { namespace } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    for (const smuggled of ['topic', 'publish'] as const) {
      records.length = 0;
      const raw = new Request('https://example.com/__sockets?m=x', {
        headers: {
          Upgrade: 'websocket',
          'x-hp-kind': smuggled,
        },
      });
      await connector({ c: makeContext(raw), ...baseCtx() });

      const fwd = records[0].request;
      // x-hp-kind must not survive; the DO will default to the room path.
      expect(
        fwd.headers.get('x-hp-kind'),
        `smuggled x-hp-kind: ${smuggled} survived into the forwarded request`
      ).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// makeDOConnState: the adapter the DO builds over ctx.getWebSockets() +
// attachments. Faked here with plain objects shaped like a hibernation
// WebSocket (send / serializeAttachment / deserializeAttachment), so the
// adapter is exercised without workerd.
// ---------------------------------------------------------------------------

interface FakeWs {
  send: (data: string) => void;
  serializeAttachment: (a: RoomConnAttachment) => void;
  deserializeAttachment: () => RoomConnAttachment;
  sent: string[];
}

function makeFakeWs(att: RoomConnAttachment): FakeWs {
  let attachment = att;
  const sent: string[] = [];
  return {
    sent,
    send: (data) => sent.push(data),
    serializeAttachment: (a) => {
      attachment = a;
    },
    deserializeAttachment: () => attachment,
  };
}

function attachment(
  connId: string,
  overrides: Partial<RoomConnAttachment> = {}
): RoomConnAttachment {
  return {
    connId,
    moduleKey: 'mod',
    name: 'room',
    params: {},
    data: null,
    presence: null,
    ...overrides,
  };
}

describe('makeDOConnState', () => {
  it('indexes by the attachment connId, not socket identity', () => {
    const a = makeFakeWs(attachment('a'));
    const b = makeFakeWs(attachment('b'));
    // Cast: the fakes are structurally the hibernation-WebSocket slice the
    // adapter touches; the test feeds them as the workerd WebSocket[] shape.
    const store = makeDOConnState([a, b] as never);

    expect(store.all().map((c) => c.id)).toEqual(['a', 'b']);
    expect(store.get('b')).toBeDefined();
    expect(store.get('missing')).toBeUndefined();
  });

  it('all().send and get().send route to the underlying socket', () => {
    const a = makeFakeWs(attachment('a'));
    const store = makeDOConnState([a] as never);

    store.all()[0].send('hello');
    store.get('a')!.send('world');
    expect(a.sent).toEqual(['hello', 'world']);
  });

  it('getState reads the attachment; setState writes it back (visible to a later read)', () => {
    const a = makeFakeWs(attachment('a', { presence: { x: 1 } }));
    const store = makeDOConnState([a] as never);

    expect(store.get('a')!.getState().presence).toEqual({ x: 1 });

    store.get('a')!.setState(attachment('a', { presence: { x: 2 } }));
    // A fresh read reflects the write (the adapter reads lazily per call).
    expect(store.get('a')!.getState().presence).toEqual({ x: 2 });
    expect(store.all()[0].getState().presence).toEqual({ x: 2 });
  });

  it('roster (via all + getState) reflects each socket presence', () => {
    const a = makeFakeWs(attachment('a', { presence: { name: 'alice' } }));
    const b = makeFakeWs(attachment('b', { presence: { name: 'bob' } }));
    const store = makeDOConnState([a, b] as never);

    const roster = store
      .all()
      .map((c) => ({ id: c.id, state: c.getState().presence }));
    expect(roster).toEqual([
      { id: 'a', state: { name: 'alice' } },
      { id: 'b', state: { name: 'bob' } },
    ]);
  });
});

describe('isTopicSubscriber', () => {
  it('true only for a { kind: "topic" } attachment', () => {
    expect(isTopicSubscriber({ kind: 'topic' })).toBe(true);
    expect(isTopicSubscriber({ connId: 'c1', moduleKey: 'm', name: 'n' })).toBe(
      false
    );
    expect(isTopicSubscriber(null)).toBe(false);
    expect(isTopicSubscriber(undefined)).toBe(false);
    expect(isTopicSubscriber('topic')).toBe(false);
    expect(isTopicSubscriber({ kind: 'room' })).toBe(false);
  });
});

describe('fanOutToTopicSubscribers', () => {
  it('sends the body to every subscriber and isolates a throwing send', () => {
    const sent: string[] = [];
    const ok1 = { send: (b: string) => sent.push(`1:${b}`) };
    const bad = {
      send: () => {
        throw new Error('socket is closing');
      },
    };
    const ok2 = { send: (b: string) => sent.push(`2:${b}`) };

    // The middle socket throws; the loop must not abort, so ok2 (iterated after
    // bad) still receives the body. A bare for-loop would drop it.
    expect(() =>
      fanOutToTopicSubscribers(
        [ok1, bad, ok2] as unknown as WebSocket[],
        'frame'
      )
    ).not.toThrow();
    expect(sent).toEqual(['1:frame', '2:frame']);
  });
});

describe('makeServerSocketHandle', () => {
  it('JSON-stringifies sends, forwards close, exposes data + raw', () => {
    const sends: string[] = [];
    const closes: Array<{ c?: number; r?: string }> = [];
    const ws = {
      send: (d: string) => sends.push(d),
      close: (c?: number, r?: string) => closes.push({ c, r }),
    };
    const socket = makeServerSocketHandle(ws, { who: 'alice' });
    socket.send({ hello: 1 });
    socket.close(4000, 'bye');
    expect(sends).toEqual([JSON.stringify({ hello: 1 })]);
    expect(closes).toEqual([{ c: 4000, r: 'bye' }]);
    expect(socket.data).toEqual({ who: 'alice' });
    expect(socket.raw).toBe(ws);
  });
});

describe('isSocketConnection', () => {
  it('is true only for a {kind:"socket"} attachment', () => {
    expect(isSocketConnection({ kind: 'socket', moduleKey: 'm', name: 's', data: null })).toBe(true);
    expect(isSocketConnection({ kind: 'topic' })).toBe(false);
    expect(isSocketConnection({ connId: 'x' })).toBe(false); // room attachment
    expect(isSocketConnection(null)).toBe(false);
  });
});

describe('makeCfForwardConnector: socket-forward', () => {
  function fakeNamespace() {
    const calls: { idArg: unknown; fetched: Request[] }[] = [];
    let uniqueCount = 0;
    const ns = {
      newUniqueId: () => ({ __unique: ++uniqueCount }) as unknown,
      idFromName: (n: string) => ({ __named: n }) as unknown,
      get: (id: unknown) => {
        const rec = { idArg: id, fetched: [] as Request[] };
        calls.push(rec);
        return {
          fetch: (req: Request) => {
            rec.fetched.push(req);
            return Promise.resolve(new Response('forwarded'));
          },
        };
      },
    };
    return { ns: ns as never, calls };
  }

  it('mints a fresh DO (newUniqueId) and stamps x-hp-kind: socket + headers', async () => {
    const { ns, calls } = fakeNamespace();
    const connector = makeCfForwardConnector(() => ns);
    const c = {
      req: { raw: new Request('https://x/__sockets?m=pages/chat&s=echo') },
    } as never;
    const res = await connector({
      c,
      kind: 'socket-forward',
      moduleKey: 'pages/chat',
      name: 'echo',
      data: { who: 'alice' },
    });
    expect(await res.text()).toBe('forwarded');
    expect(calls).toHaveLength(1);
    expect((calls[0]!.idArg as { __unique?: number }).__unique).toBe(1); // newUniqueId, not idFromName
    const fwd = calls[0]!.fetched[0]!;
    expect(fwd.headers.get('x-hp-kind')).toBe('socket');
    expect(fwd.headers.get('x-hp-module')).toBe('pages/chat');
    expect(fwd.headers.get('x-hp-name')).toBe('echo');
    expect(fwd.headers.get('x-hp-data')).toBe(JSON.stringify({ who: 'alice' }));
  });

  it('rejects an over-budget data bag', async () => {
    const { ns } = fakeNamespace();
    const connector = makeCfForwardConnector(() => ns);
    const c = { req: { raw: new Request('https://x/__sockets') } } as never;
    await expect(
      connector({
        c,
        kind: 'socket-forward',
        moduleKey: 'm',
        name: 's',
        data: { big: 'x'.repeat(7 * 1024) },
      })
    ).rejects.toThrow(/forward limit/);
  });
});
