import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
// Import from the platform-free glue module, NOT realtime-do.ts: the class file
// imports `cloudflare:workers`, which does not resolve in plain vitest (Node).
// The glue holds the connector + the DOConnState adapter (testable without
// workerd); the class itself is covered end-to-end by
// packages/vite/src/__tests__/cf-room.test.ts (a real @cloudflare/vite-plugin
// workerd dev server with two ws clients).
import {
  makeCfForwardConnector,
  makeCfRoomTransport,
  makeDOConnState,
  socketsForCloseEvent,
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
// `c`; the deny path carries no fields beyond `c` and is exercised in
// packages/vite/src/__tests__/cf-room.test.ts (the deny close needs
// WebSocketPair, a workerd-only global).
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
    // One DO per topic, on the ROOM-prefixed id namespace so a room and a
    // live-loader topic that reuse the same channel key never co-reside.
    expect(fwd.id).toBe('room:room/abc');

    // The x-hp-* headers carry the resolved room context (topic stays bare; the
    // prefix is only on the DO id derivation).
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

  it('omits x-hp-data when the room has no data factory (undefined -> absent, Node parity)', async () => {
    const records: ForwardRecord[] = [];
    const { namespace } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    await connector({
      c: makeContext(upgradeRequest()),
      ...baseCtx({ data: undefined }),
    });

    // Absent header -> the DO resolves room conn.data to undefined, matching Node.
    expect(records[0].request.headers.has('x-hp-data')).toBe(false);
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

  it('drops a client-supplied x-hp-data when the room has no data factory (identity-spoof defense)', async () => {
    // Regression: the DO surfaces x-hp-data verbatim as conn.data, the carrier
    // for server-established identity. A non-browser client sends its own
    // x-hp-data; the room's data factory returns undefined, so the connector
    // does NOT set the header. Without stripping the server-controlled x-hp-*
    // namespace first, the client's forged header would survive into the DO and
    // become conn.data. It must not.
    const records: ForwardRecord[] = [];
    const { namespace } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    const raw = new Request('https://example.com/__sockets?m=x', {
      headers: {
        Upgrade: 'websocket',
        'x-hp-data': JSON.stringify({ id: 'victim', role: 'admin' }),
      },
    });
    await connector({
      c: makeContext(raw),
      ...baseCtx({ data: undefined }),
    });

    // The forged header must not reach the DO: absent -> conn.data is undefined.
    expect(records[0].request.headers.has('x-hp-data')).toBe(false);
  });

  it('overwrites a client-supplied x-hp-data with the server value when a factory runs', async () => {
    const records: ForwardRecord[] = [];
    const { namespace } = makeFakeNamespace(records);
    const connector = makeCfForwardConnector(() => namespace as never);

    const raw = new Request('https://example.com/__sockets?m=x', {
      headers: {
        Upgrade: 'websocket',
        'x-hp-data': JSON.stringify({ id: 'victim', role: 'admin' }),
      },
    });
    await connector({
      c: makeContext(raw),
      ...baseCtx({ data: { user: 'alice' } }),
    });

    // Server value wins; the client's forged identity is gone.
    expect(records[0].request.headers.get('x-hp-data')).toBe(
      JSON.stringify({ user: 'alice' })
    );
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

  // If a channel key is reused across a room AND a live-loader topic, both can
  // land on one DO. The room store must view ONLY room connections, or a topic
  // subscriber becomes a phantom { id: undefined } roster member and receives
  // leaked room broadcasts.
  it('excludes non-room sockets (topic subscribers) from the room store', () => {
    const room = makeFakeWs(attachment('r1', { presence: { x: 1 } }));
    const topic = {
      sent: [] as string[],
      send(d: string) {
        this.sent.push(d);
      },
      serializeAttachment: () => {},
      deserializeAttachment: () => ({ kind: 'topic' }),
    };
    const store = makeDOConnState([room, topic] as never);

    // Only the room connection is visible; no phantom undefined-id member.
    expect(store.all().map((c) => c.id)).toEqual(['r1']);
    expect(store.get('r1')).toBeDefined();
  });

  it('a sender-excluded room broadcast does not leak to a co-located topic subscriber', () => {
    const sender = makeFakeWs(attachment('r1'));
    const other = makeFakeWs(attachment('r2'));
    const topicSent: string[] = [];
    const topic = {
      send: (d: string) => topicSent.push(d),
      serializeAttachment: () => {},
      deserializeAttachment: () => ({ kind: 'topic' }),
    };
    const store = makeDOConnState([sender, other, topic] as never);
    const t = makeCfRoomTransport('r1', store);

    // The common case: a room message is broadcast excluding the sender. The
    // topic subscriber's undefined id never equals the excluded sender id, so
    // without a kind filter it receives the leaked room frame.
    t.broadcast({ t: 'msg', from: 'r1', msg: 'hi' }, 'r1');

    expect(other.sent).toHaveLength(1); // real member receives
    expect(sender.sent).toHaveLength(0); // sender excluded
    expect(topicSent).toEqual([]); // topic subscriber NOT woken by room traffic
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
    expect(
      isSocketConnection({
        kind: 'socket',
        moduleKey: 'm',
        name: 's',
        data: null,
      })
    ).toBe(true);
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

  it('overwrites a client-supplied x-hp-kind with "socket" (smuggle defense)', async () => {
    for (const smuggled of ['topic', 'publish', 'room'] as const) {
      const { ns, calls } = fakeNamespace();
      const connector = makeCfForwardConnector(() => ns);
      const c = {
        req: {
          raw: new Request('https://x/__sockets?m=pages/chat&s=echo', {
            headers: { 'x-hp-kind': smuggled },
          }),
        },
      } as never;
      await connector({
        c,
        kind: 'socket-forward',
        moduleKey: 'pages/chat',
        name: 'echo',
        data: undefined,
      });
      const fwd = calls[0]!.fetched[0]!;
      expect(
        fwd.headers.get('x-hp-kind'),
        `smuggled x-hp-kind: ${smuggled} must be overwritten to 'socket'`
      ).toBe('socket');
    }
  });

  it('omits x-hp-data when the socket has no data factory (undefined -> absent, Node parity)', async () => {
    const { ns, calls } = fakeNamespace();
    const connector = makeCfForwardConnector(() => ns);
    const c = { req: { raw: new Request('https://x/__sockets') } } as never;
    await connector({
      c,
      kind: 'socket-forward',
      moduleKey: 'm',
      name: 's',
      data: undefined,
    });
    const fwd = calls[0]!.fetched[0]!;
    // Absent header -> the DO resolves socket.data to undefined, matching Node.
    expect(fwd.headers.has('x-hp-data')).toBe(false);
  });

  it('stamps x-hp-data as "null" for an intentional null factory result', async () => {
    const { ns, calls } = fakeNamespace();
    const connector = makeCfForwardConnector(() => ns);
    const c = { req: { raw: new Request('https://x/__sockets') } } as never;
    await connector({
      c,
      kind: 'socket-forward',
      moduleKey: 'm',
      name: 's',
      data: null,
    });
    const fwd = calls[0]!.fetched[0]!;
    expect(fwd.headers.get('x-hp-data')).toBe('null');
  });

  it('drops a client-supplied x-hp-data when the socket has no data factory (identity-spoof defense)', async () => {
    // Mirror of the room-branch regression: the DO surfaces x-hp-data as
    // socket.data. A client sends a forged x-hp-data and the factory returns
    // undefined (skips the set()); the forged header must not survive.
    const { ns, calls } = fakeNamespace();
    const connector = makeCfForwardConnector(() => ns);
    const c = {
      req: {
        raw: new Request('https://x/__sockets?m=pages/chat&s=echo', {
          headers: {
            'x-hp-data': JSON.stringify({ id: 'victim', role: 'admin' }),
          },
        }),
      },
    } as never;
    await connector({
      c,
      kind: 'socket-forward',
      moduleKey: 'pages/chat',
      name: 'echo',
      data: undefined,
    });
    const fwd = calls[0]!.fetched[0]!;
    expect(fwd.headers.has('x-hp-data')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Close-time store membership: the runtime evicts the closing socket from
// getWebSockets() before webSocketClose runs, so the close store must
// re-include it (Node parity) so onLeave's conn still resolves its data bag and
// the leaver appears in the roster. This pins the decision #storeWith relies on.
// ---------------------------------------------------------------------------

describe('socketsForCloseEvent', () => {
  it('re-includes the closing socket when the runtime already evicted it', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    // The closing socket `b` is NOT in the live set (already evicted).
    const result = socketsForCloseEvent([a], b);
    expect(result).toContain(b);
    expect(result).toHaveLength(2);
  });

  it('does not duplicate the closing socket when it is still live', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    // On an error the socket is usually still present; it must not be listed
    // twice (else a broadcast double-sends to it).
    const result = socketsForCloseEvent([a, b], b);
    expect(result.filter((s) => s === b)).toHaveLength(1);
    expect(result).toHaveLength(2);
  });

  it('makes the evicted closing socket resolvable in the transport store/roster', () => {
    // End-to-end at the glue level: with the closing socket re-included, the
    // transport resolves its data and lists it in the roster, which is what
    // onLeave reads.
    const leaver = {
      deserializeAttachment: () => ({
        connId: 'leaver',
        moduleKey: 'm',
        name: 'r',
        params: {},
        data: { uid: 7 },
        presence: { name: 'zoe' },
      }),
      serializeAttachment: () => {},
      send: () => {},
    } as unknown as WebSocket;
    // Live set is empty (the leaver was evicted before close fired).
    const store = makeDOConnState(socketsForCloseEvent([], leaver));
    expect(store.get('leaver')?.getState().data).toEqual({ uid: 7 });
    expect(store.all().map((c) => c.id)).toContain('leaver');
  });
});
