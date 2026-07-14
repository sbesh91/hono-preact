// PARAM_SEGMENT is THIS FRAMEWORK'S OWN supported ':param' grammar, anchored
// to the WHOLE segment: ':name' where name is one or more of [A-Za-z0-9_],
// with an optional single trailing '?'/'*'/'+' flag. It is spelled ONCE, here.
// `interpolatePattern` (interpolate-pattern.ts) imports `matchParamSegment`
// below rather than carrying its own copy of the regex, so the grammar cannot
// drift out from under it the way it drifted before (an earlier version of
// this file's PARAM_SEGMENT and interpolate-pattern.ts's inline regex were
// two hand-spelled copies of the same pattern, kept in sync only by a comment
// asserting they agreed).
//
// The other two param grammars in this codebase do NOT agree with this one:
//
//   - The type-level `RouteParams` (typed-routes.ts) extracts a param from a
//     ':' at ANY position in a segment, not just its start: its extraction is
//     an unanchored template-literal split on the first ':', so
//     `RouteParams<'board:boardId'>` types a required `boardId` even though
//     PARAM_SEGMENT never matches the segment 'board:boardId' as a param.
//   - preact-iso's own runtime route matcher (`exec`) is WIDER still: it
//     binds any param name, hyphens included, so a route pattern like
//     '/board/:board-id' matches and binds fine at HTTP request time even
//     though PARAM_SEGMENT rejects the segment ':board-id'.
//
// Left unchecked, a name PARAM_SEGMENT rejects but RouteParams accepts looks
// correctly typed and required while resolving to nothing at runtime: every
// connection collapses onto one constant topic (the segment stays literal,
// see requiredParamSlots/declaredParamSlots below). `defineChannel`
// (define-channel.ts) and @hono-preact/server's route-binding boot check
// both reject the disagreeing spellings, at definition time and at boot
// respectively, reusing `isConformingParamSegment` below so the two
// validators cannot drift from each other or from this grammar. That
// rejection is what lets `requiredParamSlots`/`declaredParamSlots` rely on
// PARAM_SEGMENT as the one grammar every VALIDATED pattern actually
// satisfies.
const PARAM_SEGMENT = /^:([A-Za-z0-9_]+)([?*+])?$/;

/**
 * Match `segment` against the shared `:param` grammar (`PARAM_SEGMENT`),
 * returning the full match (the name in group 1, the optional `?`/`*`/`+`
 * modifier in group 2) or `null` when the segment is not a conforming
 * spelling. This is the ONE place `PARAM_SEGMENT` is exercised outside this
 * module: `interpolatePattern` (interpolate-pattern.ts) imports and calls
 * this function instead of re-spelling the regex, so the two can never
 * disagree on what counts as a param segment.
 */
export function matchParamSegment(segment: string): RegExpExecArray | null {
  return PARAM_SEGMENT.exec(segment);
}

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
  return matchParamSegment(segment) !== null;
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
    .map((seg) => matchParamSegment(seg))
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
 * `ctx.location.pathParams` or `onJoin`'s params, a key no real page
 * navigation could ever produce: a page's own `pathParams` come from
 * preact-iso's route matcher (`exec`, see e.g. `prefetch.ts`'s `buildLocation`),
 * not from Hono, and it only ever binds a pattern's own declared slots.
 */
export function declaredParamSlots(pattern: string): string[] {
  return pattern
    .split('/')
    .map((seg) => matchParamSegment(seg))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1]);
}
