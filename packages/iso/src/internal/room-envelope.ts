/**
 * Wire envelope and presence types for room channels.
 *
 * This module is pure (no I/O, no transport imports). All encoding and
 * decoding is a simple JSON.stringify/JSON.parse pair: the same wire
 * boundary pattern used by loaders and actions.
 *
 * Msg and State are the unserialized types; the wire treats them
 * structurally via JSON serialization.
 */

/** A single presence member as tracked in a snapshot. */
export type PresenceMember<State> = { id: string; state: State };

/**
 * Discriminated union for all messages sent over a room WebSocket.
 *
 * 'msg': a broadcast message from a member.
 * 'presence': a join/update/leave notification from a member.
 * 'snapshot': full presence roster sent on initial connection.
 */
export type RoomEnvelope<Msg, State> =
  | { from: string; t: 'msg'; msg: Msg }
  | {
      from: string;
      t: 'presence';
      op: 'join' | 'update' | 'leave';
      state?: State;
    }
  | { t: 'snapshot'; members: Array<PresenceMember<State>> };

/** Encode a room envelope for transmission over the WebSocket wire. */
export function encodeEnvelope<Msg, State>(
  e: RoomEnvelope<Msg, State>
): string {
  return JSON.stringify(e);
}

/**
 * Decode a raw WebSocket message string into a typed room envelope.
 *
 * Parsing untrusted JSON is the sanctioned cast boundary; this is the one
 * place the wire shape is asserted, mirroring how action-envelope and
 * loader-fetch treat their respective JSON parse boundaries.
 */
export function decodeEnvelope<Msg, State>(
  raw: string
): RoomEnvelope<Msg, State> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(raw) as RoomEnvelope<Msg, State>; // sanctioned wire-boundary cast
}
