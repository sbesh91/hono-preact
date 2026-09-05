import {
  globalRequestSlotKey,
  readRequestSlot,
  writeRequestSlot,
} from './request-scoped-slot.js';
import type { ChannelSnapshot } from './channel-wire.js';

// `takeChannelSnapshot` clears the slot, so `undefined` is a value this slot
// genuinely holds and belongs in its type. Mirrors `server-deny-registry.ts`.
const REGISTRY_KEY = globalRequestSlotKey<ChannelSnapshot | undefined>(
  '@hono-preact/channel-registry'
);

/**
 * Record a channel's published value for the current request. Last write wins:
 * unlike the deny registry there is no severity ordering here, and a middleware
 * that publishes twice means the later value.
 *
 * A no-op outside a request scope, which is what makes an accidental
 * module-scope publish inert rather than a crash.
 */
export function publishToChannel(id: string, value: unknown): void {
  const current = readRequestSlot(REGISTRY_KEY);
  writeRequestSlot(REGISTRY_KEY, { ...(current ?? {}), [id]: value });
}

/**
 * Merge an already-drained snapshot back into the current request scope, so a
 * handler that took a snapshot in one scope and then opens another (the
 * progressive-enhancement re-render in `page-actions-handler.ts`) does not lose
 * what the first chain published. Keys the re-render publishes itself win, on
 * the same last-write-wins rule as `publishToChannel`.
 */
export function seedChannelSnapshot(snapshot: ChannelSnapshot | null): void {
  if (snapshot === null) return;
  const current = readRequestSlot(REGISTRY_KEY);
  writeRequestSlot(REGISTRY_KEY, { ...snapshot, ...(current ?? {}) });
}

/**
 * Take ownership of this request's snapshot, clearing it. Must be called while
 * still inside the request scope: the AsyncLocalStorage store backing it is not
 * live once the scope's promise is awaited by the caller. This is the same
 * constraint `takeServerDeny` documents, and the same reason `render.tsx`
 * threads the result out through its return value rather than reading it later.
 */
export function takeChannelSnapshot(): ChannelSnapshot | null {
  const snapshot = readRequestSlot(REGISTRY_KEY);
  writeRequestSlot(REGISTRY_KEY, undefined);
  return snapshot ?? null;
}
