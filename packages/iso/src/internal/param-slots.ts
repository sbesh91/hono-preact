// The exact param-name class and single-trailing-modifier grammar that
// `interpolatePattern` (interpolate-pattern.ts) and the type-level `ParamFrom`
// (typed-routes.ts) both use: `:name` where name is one or more of
// `[A-Za-z0-9_]`, with an optional single trailing `?`/`*`/`+` flag. A segment
// that does not conform (e.g. `:b-c`, a hyphen is outside the class) is not a
// param at either the runtime interpolator or the type level, so it must not
// be treated as a slot here either: the two extractors below share this
// pattern so all four places agree on what counts as a param.
const PARAM_SEGMENT = /^:([A-Za-z0-9_]+)([?*+])?$/;

/**
 * The required `:param` slot names in a route or channel pattern: a `:name`
 * segment with no `?` (optional), `*` (rest-zero-or-more), or `+`
 * (rest-one-or-more) suffix, returned without the leading colon.
 *
 * Single-sourced so the room-key resolver (`resolveRoomKey`), the socket param
 * resolver (`resolveSocketParams`), and the boot route/channel congruence
 * check all agree on what "required" means.
 */
export function requiredParamSlots(pattern: string): string[] {
  return pattern
    .split('/')
    .map((seg) => PARAM_SEGMENT.exec(seg))
    .filter((m): m is RegExpExecArray => m !== null && m[2] === undefined)
    .map((m) => m[1]);
}

/**
 * Every declared `:param` slot name in a route or channel pattern, INCLUDING
 * optional (`:name?`) and rest (`:name*`, `:name+`) slots, with the leading
 * colon AND the trailing flag stripped.
 *
 * Answers a different question from `requiredParamSlots`: "what is allowed to
 * be present" rather than "what must be present". Used to restrict a resolved
 * params object (parsed from the untrusted wire) to the pattern's own
 * declared slots, so a client cannot smuggle an undeclared key into
 * `ctx.location.pathParams` or `onJoin`'s params, a key no real HTTP request
 * could ever produce (Hono only populates declared slots).
 */
export function declaredParamSlots(pattern: string): string[] {
  return pattern
    .split('/')
    .map((seg) => PARAM_SEGMENT.exec(seg))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1]);
}
