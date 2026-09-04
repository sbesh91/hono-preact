// The contract both tiers agree on. Kept in its own import-free leaf for the
// same reason `request-slot-key.ts` is: the server registry and the client
// store both need it, and putting it in either one makes them import each
// other.

/**
 * Every channel's published value for one server round-trip, keyed by channel
 * id. `unknown` because the values are app-authored; only the channel handle
 * that published a key knows its type, and it asserts that type at `read`.
 */
export type ChannelSnapshot = Record<string, unknown>;

/**
 * The response header carrying a snapshot on loader and action RPC.
 *
 * A header rather than a body field because the loader RPC answers with either
 * a JSON body or an SSE stream, and the action body is a discriminated union a
 * sibling field would have to be intersected onto every arm. A header is
 * uniform across all of them and reshapes no wire type.
 */
export const CHANNEL_HEADER = 'X-HP-Channels';

export function encodeSnapshot(snapshot: ChannelSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Parse a snapshot off the wire. Returns null for anything that is not a JSON
 * object, including `null`, arrays and primitives. This is a trust boundary in
 * the sense that the wire cannot prove the shape, so the check is structural
 * and total rather than a cast.
 */
export function decodeSnapshot(raw: string | null): ChannelSnapshot | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed;
}
