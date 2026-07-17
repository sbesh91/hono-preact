import {
  requiredParamSlots,
  declaredParamSlots,
  isPresentParamSlot,
} from '@hono-preact/iso/internal/runtime';

/**
 * The outcome of parsing a route or channel PATTERN's `:param` slots off the
 * untrusted `SOCKET_KEY_PARAM` wire (`r=<JSON>`). Shared by the route-BOUND
 * socket branch of `resolveConnection` (socket-resolution.ts) and
 * `resolveRoomKey` (rooms-handler.ts, for a room channel): both call sites
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
 *  3. Restrict to `pattern`'s DECLARED slots (`declaredParamSlots`): a real
 *     HTTP request or channel key can never populate an undeclared key, so a
 *     wire key outside the pattern's own slots is dropped rather than
 *     trusted. This restriction runs BEFORE the non-string check below, so an
 *     undeclared extra (e.g. a stray `count: 3` carried in from a wider
 *     record the caller passed) is dropped, not treated as a contract
 *     violation: a payload is only rejected for a bad value under a slot the
 *     pattern actually declares.
 *  4. Any non-string value under a DECLARED slot is an `invalid-payload`
 *     deny, not a silent per-entry drop: a non-string value for a slot the
 *     pattern cares about is a contract lie the same as a non-object payload.
 *  5. Every one of `pattern`'s REQUIRED slots (`requiredParamSlots`) must be
 *     an OWN property (`isPresentParamSlot`, never one resolved through the
 *     prototype chain) with a non-empty value, or the whole parse denies
 *     with `missing-params` naming the absent slots.
 *
 * The resulting `params` is an ordinary object restricted to the pattern's
 * declared slots. Its own presence check uses `isPresentParamSlot`
 * (`Object.hasOwn`, never a bare index read), so an ABSENT slot never
 * resolves an inherited `Object.prototype` member. The prototype-chain auth
 * bypass a guard could hit (reading a missing `:constructor`/`:toString` slot
 * and getting the inherited truthy member) is closed at its source: no
 * route/channel can DECLARE a reserved param name (`isReservedParamName`, at
 * `defineRoutes`/`assertConformingChannelName`), and this parse restricts the
 * wire to those same declared slots, so a reserved name can never be a key
 * here regardless of the object's prototype.
 */
export function parseKeyParams(
  pattern: string,
  rawR: string | undefined
): ParamsParseResult {
  let params: Record<string, string> = {};
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
    // One pass over the wire entries: drop an undeclared key (a real HTTP
    // request or channel key can never populate one), reject a non-string
    // value under a DECLARED slot (a contract lie), and keep the rest.
    // Restricting to declared slots BEFORE the non-string check means an
    // undeclared extra never influences the verdict. `declared` excludes every
    // reserved name (no route or channel can declare one), so no key assigned
    // here can be `__proto__` or an `Object.prototype` member: an ordinary
    // object is safe.
    const declared = new Set(declaredParamSlots(pattern));
    const collected: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!declared.has(key)) continue;
      if (typeof value !== 'string') {
        return { ok: false, reason: 'invalid-payload' };
      }
      collected[key] = value;
    }
    params = collected;
  }
  const missing = requiredParamSlots(pattern).filter(
    (slot) => !isPresentParamSlot(params, slot)
  );
  return missing.length === 0
    ? { ok: true, params }
    : { ok: false, reason: 'missing-params', missing };
}
