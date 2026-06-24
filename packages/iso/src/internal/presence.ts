// Process-global presence registry: which connections are in which room, and
// each one's last-published presence state. Pure of transport: it knows nothing
// of WebSockets or pub/sub. The room runtime (in @hono-preact/server) drives it
// and is the sole layer that pairs a presence change with a wire broadcast.
//
// State is stored as `unknown` because one registry is shared across
// heterogeneous rooms (each room has its own State type); the room runtime
// reads it back at its own typed boundary. Mirrors pubsub.ts's Symbol.for +
// globalThis accessor so the roster survives HMR and multiple module
// evaluations, and prunes an emptied topic the way pubsub prunes an empty Set.

import type { PresenceMember } from './room-envelope.js';

const REGISTRY_KEY = Symbol.for('@hono-preact/presence');

type Roster = Map<string, Map<string, unknown>>;

type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: Roster;
};

function registry(): Roster {
  const g = globalThis as GlobalWithRegistry;
  return (g[REGISTRY_KEY] ??= new Map());
}

/** Add a connection to a topic's presence roster with its initial state. */
export function joinPresence(
  topic: string,
  connId: string,
  state: unknown
): void {
  const reg = registry();
  let members = reg.get(topic);
  if (!members) {
    members = new Map();
    reg.set(topic, members);
  }
  members.set(connId, state);
}

/**
 * Remove a connection from a topic's presence roster. When the topic empties,
 * prune it so the roster does not accumulate dead topics (mirrors pubsub.ts
 * deleting an emptied subscriber Set).
 */
export function leavePresence(topic: string, connId: string): void {
  const members = registry().get(topic);
  if (!members) return;
  members.delete(connId);
  if (members.size === 0) registry().delete(topic);
}

/**
 * Replace a connection's presence state. A no-op when the topic or connection
 * is unknown: presence updates only matter for a live member, and creating a
 * topic here would resurrect a pruned room.
 */
export function updatePresence(
  topic: string,
  connId: string,
  state: unknown
): void {
  const members = registry().get(topic);
  if (!members || !members.has(connId)) return;
  members.set(connId, state);
}

/** The current roster for a topic as `{ id, state }[]` (empty when unknown). */
export function presenceMembers(topic: string): Array<PresenceMember<unknown>> {
  const members = registry().get(topic);
  if (!members) return [];
  return [...members].map(([id, state]) => ({ id, state }));
}

/** Test-only: clear the whole process-global roster between tests. */
export function __resetPresenceForTesting(): void {
  registry().clear();
}
