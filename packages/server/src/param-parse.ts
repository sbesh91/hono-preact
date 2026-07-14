import {
  requiredParamSlots,
  declaredParamSlots,
  toNullProtoParams,
  isPresentParamSlot,
} from '@hono-preact/iso/internal/runtime';

/**
 * The outcome of parsing a route or channel PATTERN's `:param` slots off the
 * untrusted `SOCKET_KEY_PARAM` wire (`r=<JSON>`). Shared by
 * `resolveSocketParams` (socket-resolution.ts, for a route-BOUND socket) and
 * `resolveRoomKey` (rooms-handler.ts, for a room channel): both resolvers
 * parse the SAME wire shape (a query-string `r=` carrying a JSON object of
 * string values) against a pattern's declared/required `:param` slots, so
 * `parseKeyParams` below is the ONE copy of that pipeline. Two hand-written
 * copies is exactly how the prototype-chain auth bypass (see
 * `isPresentParamSlot`'s doc, param-slots.ts) shipped fixed in one resolver
 * and not the other.
 */
export type ParamsParseResult =
  | { ok: true; params: Record<string, string> }
  /** The `r=` query was present but is not a JSON object of string values. */
  | { ok: false; reason: 'invalid-payload' }
  /** The payload was well formed, but these required slots are absent or empty. */
  | { ok: false; reason: 'missing-params'; missing: string[] };

/**
 * Parse + validate a route or channel PATTERN's `:param` slots from the
 * untrusted `SOCKET_KEY_PARAM` wire value. Pure (no I/O), so both call sites
 * can run it before the guard chain and feed the guard the resolved params.
 *
 * Pipeline:
 *  1. An absent/empty `rawR` means no params: start from `{}` and fall
 *     through to the required-slot check.
 *  2. `JSON.parse` the payload. A parse failure, or a parse result that is
 *     not a plain object (`null`, an array, a primitive), is an
 *     `invalid-payload` deny: a present-but-unusable payload is a contract
 *     lie, not a missing param, so it is rejected outright rather than
 *     coerced to `{}` (a coercion would let a garbage payload through
 *     whenever the pattern happens to have no required slots).
 *  3. Any non-string value anywhere in the parsed object is also an
 *     `invalid-payload` deny, not a silent per-entry drop: a non-string
 *     value is a contract lie the same as a non-object payload.
 *  4. Restrict to `pattern`'s DECLARED slots (`declaredParamSlots`): a real
 *     HTTP request or channel key can never populate an undeclared key, so a
 *     wire key outside the pattern's own slots is dropped rather than
 *     trusted.
 *  5. Every one of `pattern`'s REQUIRED slots (`requiredParamSlots`) must be
 *     an OWN property (`isPresentParamSlot`, never one resolved through the
 *     prototype chain) with a non-empty value, or the whole parse denies
 *     with `missing-params` naming the absent slots.
 *
 * The resulting `params` is built with `toNullProtoParams` (no prototype at
 * all, not even `Object.prototype`) and its presence check uses
 * `isPresentParamSlot` (`Object.hasOwn`, never a bare index read): together
 * they close the prototype-chain auth bypass where a route/channel bound to
 * e.g. `:constructor` or `:toString` would otherwise read the inherited
 * (truthy) `Object.prototype` member for an ABSENT slot and wrongly resolve
 * it as present.
 */
export function parseKeyParams(
  pattern: string,
  rawR: string | undefined
): ParamsParseResult {
  let params: Record<string, string> = toNullProtoParams([]);
  if (rawR !== undefined && rawR !== '') {
    let parsed: unknown;
    try {
      // Sanctioned untrusted-wire JSON.parse: the client sends route/channel
      // key params as a JSON object whose values are all strings.
      parsed = JSON.parse(rawR);
    } catch {
      return { ok: false, reason: 'invalid-payload' };
    }
    // A PRESENT payload that is not a plain object (null, an array, a
    // primitive), or that carries a non-string value anywhere (e.g.
    // `{"x":42}`), is a contract lie rather than a missing param. Reject the
    // whole payload; do not coerce it to `{}`, which would let it pass a
    // pattern with no required slots.
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return { ok: false, reason: 'invalid-payload' };
    }
    const entries = Object.entries(parsed);
    if (entries.some(([, v]) => typeof v !== 'string')) {
      return { ok: false, reason: 'invalid-payload' };
    }
    // Every value is a string (checked above), so this is a sound narrowing,
    // not a cast over an unvalidated shape. Restrict to the pattern's
    // DECLARED slots (required + optional/rest).
    const declared = new Set(declaredParamSlots(pattern));
    params = toNullProtoParams(
      entries
        .filter((e): e is [string, string] => typeof e[1] === 'string')
        .filter(([key]) => declared.has(key))
    );
  }
  const missing = requiredParamSlots(pattern).filter(
    (slot) => !isPresentParamSlot(params, slot)
  );
  return missing.length === 0
    ? { ok: true, params }
    : { ok: false, reason: 'missing-params', missing };
}
