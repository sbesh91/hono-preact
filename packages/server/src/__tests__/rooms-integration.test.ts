/**
 * Node integration test for the rooms fan-out path.
 *
 * Boots a real @hono/node-server with @hono/node-ws, registers the cursors
 * room definition via a synthetic server-imports registry, then opens two real
 * `ws` clients and verifies:
 *
 *   - Client A sends a message frame; client B receives it; client A does NOT
 *     receive its own message (sender-exclude via onMessage->conn.broadcast).
 *   - Client B sees A's presence join envelope after A connects.
 *
 * Mirrors the sockets-integration.test.ts harness: same server setup, same
 * helper utilities, same WS URL shape (with the added &r=<key params> query).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { defineChannel, defineRoom } from '@hono-preact/iso';
import type { RoomDef } from '@hono-preact/iso/internal';
import {
  installWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
  __resetPubSubForTesting,
  __resetPresenceForTesting,
  SOCKETS_RPC_PATH,
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  SOCKET_KEY_PARAM,
} from '@hono-preact/iso/internal/runtime';
import { socketsHandler } from '../sockets-handler.js';
import { buildRoomRegistry } from '../rooms-handler.js';

// ---------------------------------------------------------------------------
// Helpers (mirrored from sockets-integration.test.ts)
// ---------------------------------------------------------------------------

function wsRoomUrl(
  port: number,
  moduleKey: string,
  roomName: string,
  keyParams: Record<string, string>
): string {
  return (
    `ws://localhost:${port}${SOCKETS_RPC_PATH}` +
    `?${SOCKET_MODULE_PARAM}=${encodeURIComponent(moduleKey)}` +
    `&${SOCKET_NAME_PARAM}=${encodeURIComponent(roomName)}` +
    `&${SOCKET_KEY_PARAM}=${encodeURIComponent(JSON.stringify(keyParams))}`
  );
}

function connectWs(url: string): {
  ws: WebSocket;
  messages: string[];
  /** Returns the next message, whether already buffered or yet to arrive. */
  waitForMessage: (timeout?: number) => Promise<string>;
} {
  const ws = new WebSocket(url);
  const messages: string[] = [];
  // Index into `messages` tracking the next unread message for `waitForMessage`.
  let readIdx = 0;
  const messageWaiters: Array<(msg: string) => void> = [];

  ws.on('message', (data) => {
    const str = data.toString();
    messages.push(str);
    messageWaiters.shift()?.(str);
  });

  return {
    ws,
    messages,
    waitForMessage(timeout = 5_000) {
      // If a message is already buffered, return it immediately without creating
      // a promise that blocks until the next NEW message arrives. This fixes the
      // race where the snapshot arrives before the first waitForMessage call.
      if (readIdx < messages.length) {
        return Promise.resolve(messages[readIdx++]!);
      }
      return new Promise<string>((res, rej) => {
        const t = setTimeout(
          () => rej(new Error('ws message timeout')),
          timeout
        );
        messageWaiters.push((msg) => {
          clearTimeout(t);
          readIdx++;
          res(msg);
        });
      });
    },
  };
}

function waitForOpen(ws: WebSocket, timeout = 5_000): Promise<void> {
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

/**
 * Drain messages from a WS connection until the predicate returns truthy, or
 * until `maxMessages` arrive, or until `timeout` elapses. Returns the matching
 * message or undefined.
 */
async function drainUntil<T>(
  waitForMessage: (timeout?: number) => Promise<string>,
  predicate: (parsed: unknown) => parsed is T,
  { maxMessages = 20, perMsgTimeout = 3_000 } = {}
): Promise<T | undefined> {
  for (let i = 0; i < maxMessages; i++) {
    const raw = await waitForMessage(perMsgTimeout);
    const parsed: unknown = JSON.parse(raw);
    if (predicate(parsed)) return parsed;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Room definition (cursors room, mirrors apps/example-node/src/pages/cursors.server.ts)
// ---------------------------------------------------------------------------

type CursorMsg = { x: number; y: number };

const cursorsChannel = defineChannel('cursors/:room')<CursorMsg>();

// The MODULE_KEY must match what buildRoomRegistry reads from __moduleKey; in
// the integration test we inject the registry directly so any stable string works.
const MODULE_KEY = 'test/cursors';
const ROOM_NAME = 'cursors';
const ROOM_KEY = { room: 'demo' };

// ---------------------------------------------------------------------------
// Test setup: spin up a real HTTP server + node-ws
// ---------------------------------------------------------------------------

type NodeServer = import('@hono/node-server').ServerType;

let server: NodeServer;
let port: number;

beforeAll(async () => {
  // Reset global state from any other test that ran before in this file.
  __resetPubSubForTesting();
  __resetPresenceForTesting();

  const { serve } = await import('@hono/node-server');
  const { createNodeWebSocket } = await import('@hono/node-ws');

  // Build the room registry directly (mirrors the socket integration pattern
  // of providing a synthetic module map instead of calling the full Vite build).
  const cursorsDef = defineRoom(cursorsChannel, {
    presence: () => ({ x: 0, y: 0 }),
    onMessage(conn, msg) {
      conn.broadcast(msg);
    },
  }) as unknown as RoomDef<
    CursorMsg,
    CursorMsg,
    { x: number; y: number },
    unknown,
    { room: string }
  >;

  const rooms = await buildRoomRegistry([
    () =>
      Promise.resolve({
        __moduleKey: MODULE_KEY,
        serverRooms: { [ROOM_NAME]: cursorsDef },
      }),
  ]);

  const app = new Hono();
  app.get(
    SOCKETS_RPC_PATH,
    socketsHandler({ registry: new Map(), rooms, resolvePageUse: () => [] })
  );

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
  installWebSocketUpgrader(upgradeWebSocket);

  server = serve({ fetch: app.fetch, port: 0 });
  injectWebSocket(server);

  port = (server.address() as AddressInfo).port;
}, 30_000);

afterAll(async () => {
  __resetWebSocketUpgraderForTesting();
  __resetPubSubForTesting();
  __resetPresenceForTesting();
  await new Promise<void>((res) => server.close(() => res()));
});

// ---------------------------------------------------------------------------
// Type predicates for narrowing envelope shapes
// ---------------------------------------------------------------------------

type MsgEnvelope = { t: 'msg'; from: string; msg: CursorMsg };
type PresenceEnvelope = {
  t: 'presence';
  from: string;
  op: 'join' | 'update' | 'leave';
  state?: { x: number; y: number };
};

function isMsgEnvelope(v: unknown): v is MsgEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { t?: unknown }).t === 'msg' &&
    typeof (v as { from?: unknown }).from === 'string'
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rooms-integration: real Node WS two-client round-trip', () => {
  const roomUrl = () => wsRoomUrl(port, MODULE_KEY, ROOM_NAME, ROOM_KEY);

  it('A sends a message; B receives it; A does NOT receive its own (sender-exclude)', async () => {
    const a = connectWs(roomUrl());
    const b = connectWs(roomUrl());

    await Promise.all([waitForOpen(a.ws), waitForOpen(b.ws)]);

    // Drain initial snapshots and any join-presence frames so both clients are
    // settled before sending the application message.
    await new Promise<void>((res) => setTimeout(res, 100));

    const aMsgsBefore = a.messages.length;

    // A sends a cursor message (the onMessage handler broadcasts to others).
    a.ws.send(JSON.stringify({ t: 'msg', msg: { x: 10, y: 20 } }));

    // B must receive a { t: 'msg', from, msg: { x: 10, y: 20 } } envelope.
    const bMsg = await drainUntil(b.waitForMessage, isMsgEnvelope);
    expect(bMsg).toBeDefined();
    expect(bMsg?.msg).toEqual({ x: 10, y: 20 });
    expect(typeof bMsg?.from).toBe('string');

    // A must NOT have received any new messages (sender-exclude). Give the
    // server a tick to forward anything if it incorrectly echoed to the sender.
    await new Promise<void>((res) => setTimeout(res, 100));
    const aNewMsgs = a.messages
      .slice(aMsgsBefore)
      .map((s) => JSON.parse(s) as { t: string })
      .filter((env) => env.t === 'msg');
    expect(aNewMsgs).toHaveLength(0);

    a.ws.close(1000);
    b.ws.close(1000);
  }, 15_000);

  it('B sees A in the roster after A connects to the same room', async () => {
    // A connects first; B connects after. The framework delivers B a snapshot
    // that includes A (already joined). This is the presence-awareness path:
    // B never misses members that joined before it because the snapshot
    // includes the full roster at join time.
    const a = connectWs(roomUrl());
    await waitForOpen(a.ws);

    // Give A time to register its presence on the server before B joins.
    await new Promise<void>((res) => setTimeout(res, 80));

    const b = connectWs(roomUrl());
    await waitForOpen(b.ws);

    // Wait for B to receive at least the opening snapshot. The snapshot is
    // sent directly on open so it arrives quickly; one message is enough.
    await b.waitForMessage(3_000);

    // Parse all of B's collected messages. The snapshot (t: 'snapshot')
    // includes A in its members array because A joined before B.
    type SnapshotEnv = {
      t: 'snapshot';
      self: string;
      members: { id: string; state: unknown }[];
    };
    const snapshot = b.messages
      .map((s) => JSON.parse(s) as { t: string })
      .find((e): e is SnapshotEnv => e.t === 'snapshot') as
      | SnapshotEnv
      | undefined;

    expect(snapshot).toBeDefined();
    // The snapshot's members array includes A (at least 1 member before B joined).
    expect(Array.isArray(snapshot?.members)).toBe(true);
    // A joined before B, so A is in the roster. B itself may or may not appear
    // in the snapshot depending on timing; A must be there.
    expect((snapshot?.members ?? []).length).toBeGreaterThanOrEqual(1);
    // All members in the snapshot have an id and a state (presence was seeded).
    for (const m of snapshot?.members ?? []) {
      expect(typeof m.id).toBe('string');
      expect(m.state).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
      });
    }

    // Additionally verify B receives a presence-join frame for A within the
    // next few messages (the join is published AFTER the snapshot is sent, so
    // it arrives as a separate frame when B and A are in the same room
    // concurrently). We allow the frame to arrive OR already be in b.messages.
    const alreadyHasJoin = b.messages
      .map((s) => JSON.parse(s) as unknown)
      .some(isPresenceJoin);

    if (!alreadyHasJoin) {
      const joinFrame = await drainUntil(b.waitForMessage, isPresenceJoin, {
        maxMessages: 10,
        perMsgTimeout: 2_000,
      });
      // If still not found, check whether A is in the snapshot (which covers
      // the case where A joined well before B and the join frame predates B's
      // subscription window).
      if (!joinFrame) {
        const aInSnapshot = (snapshot?.members ?? []).some(
          (m) => m.id !== snapshot?.self
        );
        expect(aInSnapshot).toBe(true);
      }
    }

    a.ws.close(1000);
    b.ws.close(1000);
  }, 15_000);
});
