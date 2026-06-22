import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { WebSocket } from 'ws';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end Cloudflare DO room integration test.
//
// This is the REAL validation of the realtime Cloudflare path: a fixture
// hono-preact app using cloudflareAdapter() is served through the
// @cloudflare/vite-plugin workerd dev server (same mechanism as the
// "Cloudflare adapter: WebSocket in dev" suite in websocket-dev.test.ts). Two
// real `ws` clients connect to the framework room endpoint (/__sockets), and we
// assert the intra-DO fan-out + presence roster end to end:
//
//   - the worker forwards the guarded upgrade to the topic's Durable Object,
//   - the DO accepts the socket for hibernation and drives the shared room
//     engine,
//   - client A's broadcast reaches client B (and NOT A: sender-exclude),
//   - B sees A in the join snapshot / a presence-join frame,
//   - A's close removes it from the roster (B gets a presence-leave frame).
//
// THE CRITICAL THING THIS TEST CONFIRMS: the cross-isolate room registry. For
// the DO to resolve the room def, getRoomRegistry() must return the installed
// registry INSIDE the DO isolate. The generated CF worker entry installs it via
// installRoomRegistry(...) at module top level (adapter-cloudflare's wrapEntry).
// If the DO isolate does not re-evaluate that module's top level, the DO throws
// "no room registry installed" and fan-out fails. A green run here proves the
// cross-isolate install works.

const here = dirname(fileURLToPath(import.meta.url));
const cfRoomRoot = resolve(here, 'fixtures/cf-room');

// The room wire identity the client must send (see rooms-handler.resolveRoomKey
// and use-room.buildUrl). The moduleKey is deriveModuleKey(absServerPath,
// viteRoot): with the vite root at the fixture dir, src/room.server.ts derives
// to "src/room". The room NAME is the `serverRooms` property name ("room"). The
// channel is `room/:id`, so the key params carry `{ id }`.
const MODULE_KEY = 'src/room';
const ROOM_NAME = 'room';
const ROOM_KEY = { id: 'demo' };

// The /__sockets contract (packages/iso/src/internal/contract.ts):
//   path = '/__sockets', m = moduleKey, s = name, r = JSON(key params).
const SOCKETS_RPC_PATH = '/__sockets';

function serverPort(server: ViteDevServer): number {
  const addr = server.httpServer!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

function roomUrl(port: number): string {
  return (
    `ws://localhost:${port}${SOCKETS_RPC_PATH}` +
    `?m=${encodeURIComponent(MODULE_KEY)}` +
    `&s=${encodeURIComponent(ROOM_NAME)}` +
    `&r=${encodeURIComponent(JSON.stringify(ROOM_KEY))}`
  );
}

/** Connect a `ws` client and buffer every message it receives. */
function connectWs(url: string): {
  ws: WebSocket;
  messages: string[];
  waitForMessage: (timeout?: number) => Promise<string>;
} {
  const ws = new WebSocket(url);
  const messages: string[] = [];
  let readIdx = 0;
  const waiters: Array<(msg: string) => void> = [];

  ws.on('message', (data) => {
    const str = data.toString();
    messages.push(str);
    waiters.shift()?.(str);
  });

  return {
    ws,
    messages,
    waitForMessage(timeout = 5_000) {
      // Return an already-buffered message immediately so a snapshot that
      // arrived before the first call is not missed.
      if (readIdx < messages.length) {
        return Promise.resolve(messages[readIdx++]!);
      }
      return new Promise<string>((res, rej) => {
        const t = setTimeout(
          () => rej(new Error('ws message timeout')),
          timeout
        );
        waiters.push((msg) => {
          clearTimeout(t);
          readIdx++;
          res(msg);
        });
      });
    },
  };
}

function waitForOpen(ws: WebSocket, timeout = 10_000): Promise<void> {
  return new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) {
      res();
      return;
    }
    const t = setTimeout(() => rej(new Error('ws open timeout')), timeout);
    ws.once('open', () => {
      clearTimeout(t);
      res();
    });
    ws.once('error', (err) => {
      clearTimeout(t);
      rej(err);
    });
  });
}

/** Drain messages until the predicate matches, `max` arrive, or it times out. */
async function drainUntil<T>(
  waitForMessage: (timeout?: number) => Promise<string>,
  predicate: (parsed: unknown) => parsed is T,
  { maxMessages = 20, perMsgTimeout = 5_000 } = {}
): Promise<T | undefined> {
  for (let i = 0; i < maxMessages; i++) {
    let raw: string;
    try {
      raw = await waitForMessage(perMsgTimeout);
    } catch {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    if (predicate(parsed)) return parsed;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Envelope type predicates (server -> client wire shapes)
// ---------------------------------------------------------------------------

type RoomMsg = { x: number };
type MsgEnvelope = { t: 'msg'; from: string; msg: RoomMsg };
type SnapshotEnvelope = {
  t: 'snapshot';
  self: string;
  members: { id: string; state: unknown }[];
};
type PresenceEnvelope = {
  t: 'presence';
  from: string;
  op: 'join' | 'update' | 'leave';
  state?: unknown;
};

function isMsgEnvelope(v: unknown): v is MsgEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { t?: unknown }).t === 'msg' &&
    typeof (v as { from?: unknown }).from === 'string'
  );
}

function isSnapshotEnvelope(v: unknown): v is SnapshotEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { t?: unknown }).t === 'snapshot' &&
    Array.isArray((v as { members?: unknown }).members)
  );
}

function isPresenceJoin(v: unknown): v is PresenceEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { t?: unknown }).t === 'presence' &&
    (v as { op?: unknown }).op === 'join' &&
    typeof (v as { from?: unknown }).from === 'string'
  );
}

function isPresenceLeave(v: unknown): v is PresenceEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { t?: unknown }).t === 'presence' &&
    (v as { op?: unknown }).op === 'leave' &&
    typeof (v as { from?: unknown }).from === 'string'
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Cloudflare adapter: DO room (two ws clients, intra-DO fan-out)', () => {
  let server: ViteDevServer;
  let originalCwd: string;

  beforeAll(async () => {
    // The framework's serverEntryPlugin writes the generated server-entry to
    // `${process.cwd()}/node_modules/.vite/hono-preact/server-entry.tsx`, and
    // wrangler.jsonc's `main` points at that path relative to the wrangler dir
    // (= the vite root = the fixture dir). They only line up when cwd is the
    // fixture dir, so chdir there (mirrors the Node WebSocket-in-dev suite).
    originalCwd = process.cwd();
    process.chdir(cfRoomRoot);
    server = await createServer({ root: cfRoomRoot, server: { port: 0 } });
    await server.listen();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    process.chdir(originalCwd);
  });

  it('A broadcasts -> B receives, A does not (intra-DO sender-exclude); B sees A join; A close -> B sees leave', async () => {
    const port = serverPort(server);

    // A connects first so it is already in the roster when B joins.
    const a = connectWs(roomUrl(port));
    await waitForOpen(a.ws);

    // Let A register its presence in the DO before B joins.
    await new Promise<void>((res) => setTimeout(res, 300));

    const b = connectWs(roomUrl(port));
    await waitForOpen(b.ws);

    // --- Assertion 1: B's join snapshot includes A (roster awareness) -------
    const snapshot = await drainUntil(b.waitForMessage, isSnapshotEnvelope);
    expect(snapshot).toBeDefined();
    // A joined before B, so the roster B receives has at least one member.
    expect((snapshot?.members ?? []).length).toBeGreaterThanOrEqual(1);
    const aId = (snapshot?.members ?? []).find(
      (m) => m.id !== snapshot?.self
    )?.id;
    expect(aId).toBeDefined();

    // Settle: give both clients a beat so any join-presence frames have flushed.
    await new Promise<void>((res) => setTimeout(res, 200));
    const aMsgCountBefore = a.messages.length;

    // --- Assertion 2: A broadcasts -> B receives it -------------------------
    a.ws.send(JSON.stringify({ t: 'msg', msg: { x: 42 } }));

    const bMsg = await drainUntil(b.waitForMessage, isMsgEnvelope);
    expect(bMsg).toBeDefined();
    expect(bMsg?.msg).toEqual({ x: 42 });
    expect(typeof bMsg?.from).toBe('string');

    // --- Assertion 3: A does NOT receive its own broadcast (sender-exclude) --
    await new Promise<void>((res) => setTimeout(res, 200));
    const aNewMsgs = a.messages
      .slice(aMsgCountBefore)
      .map((s) => JSON.parse(s) as { t: string })
      .filter((env) => env.t === 'msg');
    expect(aNewMsgs).toHaveLength(0);

    // --- Assertion 4: A closes -> B receives a presence-leave for A ---------
    a.ws.close(1000);

    const leave = await drainUntil(b.waitForMessage, isPresenceLeave, {
      maxMessages: 15,
      perMsgTimeout: 4_000,
    });
    expect(leave).toBeDefined();
    // The leave names A (the member that just closed). The leave `from` must be
    // A's id (the only other member B knew about).
    expect(leave?.from).toBe(aId);

    b.ws.close(1000);
  }, 60_000);
});
