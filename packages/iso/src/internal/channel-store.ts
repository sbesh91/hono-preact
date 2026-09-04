import { isBrowser } from '../is-browser.js';
import { decodeSnapshot, type ChannelSnapshot } from './channel-wire.js';

// In-memory and deliberately NOT persisted. A cold load always arrives with a
// server-authored snapshot in the SSR bootstrap, so there is nothing to carry
// across sessions and therefore nothing that can go stale across them. Putting
// this in localStorage would reintroduce the exact drift #398 exists to remove.
let current: ChannelSnapshot = {};

/**
 * Install the snapshot from a server round-trip.
 *
 * REPLACES rather than merges. A round-trip whose chain published nothing for a
 * channel means that channel has no value now, which is how a logout clears a
 * session hint without the app writing any code. Merging would make a published
 * value permanent for the life of the page.
 *
 * A `null` snapshot means the response carried no header at all, which is not
 * the same statement: plenty of responses never run a route-node chain. Those
 * leave the store untouched.
 */
export function applyChannelSnapshot(snapshot: ChannelSnapshot | null): void {
  if (snapshot === null) return;
  current = snapshot;
}

export function readChannelValue(id: string): unknown {
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
  applyChannelSnapshot(decodeSnapshot(JSON.stringify(raw)));
}
