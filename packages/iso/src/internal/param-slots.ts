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
 * True iff `segment` is a conforming `:param` segment (the same grammar
 * `PARAM_SEGMENT` matches): a `:name` where `name` is one or more of
 * `[A-Za-z0-9_]`, with an optional single trailing `?`/`*`/`+` flag. Exported
 * so a definition-time validator (`defineChannel`) can reject a non-conforming
 * `:`-prefixed segment (e.g. `:board-id`, a hyphen is outside the class)
 * loudly, at the same grammar `requiredParamSlots` and `declaredParamSlots`
 * use, rather than re-spelling the regex and risking drift.
 */
export function isConformingParamSegment(segment: string): boolean {
  return PARAM_SEGMENT.test(segment);
}

/**
 * The required `:param` slot names in a route or channel pattern: a `:name`
 * segment with no modifier or with the `+` (rest-one-or-more) modifier,
 * returned without the leading colon. `?` (optional) and `*`
 * (rest-zero-or-more) are excluded; `+` is included because both the
 * type-level `StripModifier` (typed-routes.ts) and the runtime route matcher
 * (preact-iso's `exec`, which refuses to match a `+` segment with no value)
 * treat a `+` slot as required.
 *
 * Single-sourced so the room-key resolver (`resolveRoomKey`), the socket param
 * resolver (`resolveSocketParams`), and the boot route/channel congruence
 * check all agree on what "required" means.
 */
export function requiredParamSlots(pattern: string): string[] {
  return pattern
    .split('/')
    .map((seg) => PARAM_SEGMENT.exec(seg))
    .filter(
      (m): m is RegExpExecArray => m !== null && m[2] !== '?' && m[2] !== '*'
    )
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
