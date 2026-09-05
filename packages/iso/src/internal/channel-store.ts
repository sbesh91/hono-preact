import { isBrowser } from '../is-browser.js';
import { decodeSnapshot, type ChannelSnapshot } from './channel-wire.js';

// In-memory and deliberately NOT persisted. A cold load always arrives with a
// server-authored snapshot in the SSR bootstrap, so there is nothing to carry
// across sessions and therefore nothing that can go stale across them. Putting
// this in localStorage would reintroduce the exact drift #398 exists to remove.
let current: ChannelSnapshot = {};

// Every accessor below is browser-gated, and that gate is load-bearing rather
// than tidiness. This module sits in the SERVER graph too: `form.tsx` and
// `action.ts` both import `applyChannelSnapshot` statically and both run during
// SSR. `current` is module scope, so on the server it is per-isolate, not
// per-request: one Cloudflare Workers isolate or one long-lived Node process
// serves many users off the same binding, and a server-side write would be
// cross-user state. The server tier has its own per-request store
// (`channel-registry.ts`, backed by AsyncLocalStorage); this one is the client
// tier's, so off the browser a write is a no-op and a read is `undefined`.

/**
 * Install the snapshot from a server round-trip.
 *
 * MERGES per key. A round-trip only publishes on the channels its own chain
 * touched, so a key the response says nothing about keeps the value it already
 * had. Clearing a channel is an explicit publish of a falsy value, which is a
 * statement the response actually carries.
 *
 * A `null` snapshot means the response carried no header at all. Plenty of
 * responses never run a route-node chain; those leave the store untouched.
 */
export function applyChannelSnapshot(snapshot: ChannelSnapshot | null): void {
  if (!isBrowser()) return;
  if (snapshot === null) return;
  current = { ...current, ...snapshot };
}

export function readChannelValue(id: string): unknown {
  if (!isBrowser()) return undefined;
  return current[id];
}

/** Test-only reset. Not exported from the package index. */
export function resetChannelStore(): void {
  current = {};
}

/**
 * Seed the store from the SSR bootstrap global. Called once during client boot,
 * before any client middleware chain runs, so a guard on the initial load reads
 * a server-authored value rather than an empty store.
 */
export function hydrateChannelsFromDocument(): void {
  if (!isBrowser()) return;
  const raw = (globalThis as { __HP_CHANNELS__?: unknown }).__HP_CHANNELS__;
  if (raw === undefined) return;
  // Re-encode and run the same total decoder the header path uses, so one
  // structural check covers both transports and neither can accept a shape the
  // other rejects.
  //
  // The global is whatever the page's last-writing script left there, and
  // JSON.stringify throws on a circular object or a BigInt. This runs inside
  // bootClient, so an escaping throw would take hydration for the whole page
  // down. A global the decoder cannot read leaves the store as it was.
  let encoded: string;
  try {
    encoded = JSON.stringify(raw);
  } catch {
    return;
  }
  applyChannelSnapshot(decodeSnapshot(encoded));
}
