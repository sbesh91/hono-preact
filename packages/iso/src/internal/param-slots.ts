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

/**
 * Every param name a guard could actually read off `ctx.location.pathParams`
 * for a request that matches `pattern`, per preact-iso's OWN runtime route
 * matcher (`exec`, in `preact-iso/src/router.js`). This is deliberately
 * WIDER than `PARAM_SEGMENT`/`declaredParamSlots`: it answers "what can a
 * guard actually read", not "what does this framework's `:param` grammar
 * support".
 *
 * `exec` binds any segment starting with `:` as a param, matching it against
 * `/^(:?)(.*?)([+*?]?)$/`: the name is everything after the leading `:` with
 * a single trailing `+`/`*`/`?` modifier char stripped, no character-class
 * restriction at all (hyphens, dots, extra colons all bind fine). A segment
 * that does NOT start with `:` (including a bare `*` wildcard, or a
 * colon-namespaced literal like `metrics:cpu`) is never a param to `exec`
 * either, so this function agrees with the framework's own grammar on what
 * counts as a param SITE (leading `:`), just not on which NAMES are legal
 * there.
 *
 * Used by `@hono-preact/server`'s route-binding boot check to detect every
 * route param a guard could misread as `undefined`, including one
 * `declaredParamSlots` is blind to (e.g. `:board-id`, a hyphenated name):
 * left undetected, such a param silently fails both the boot-throw and the
 * dev advisory `declaredParamSlots` was driving, even though it IS live over
 * plain HTTP. Substitution and wire-filtering stay on the narrower
 * `declaredParamSlots`/`requiredParamSlots` grammar; those describe what the
 * framework can SUPPLY (the room-key/socket-param resolvers only ever
 * resolve a conforming `:param` slot), not what a guard can read.
 */
export function guardReadableParamSlots(pattern: string): string[] {
  return pattern
    .split('/')
    .filter((seg) => seg.startsWith(':'))
    .map((seg) => {
      const body = seg.slice(1);
      return /[+*?]$/.test(body) ? body.slice(0, -1) : body;
    });
}

/**
 * Build a params record with NO prototype (not even `Object.prototype`),
 * from a list of `[key, value]` entries. Used by `resolveSocketParams`
 * (`@hono-preact/server`'s socket-resolution.ts) and `resolveRoomKey`
 * (rooms-handler.ts) to build the params object they parse off the
 * untrusted wire.
 *
 * `requiredParamSlots` accepts any `[A-Za-z0-9_]+` slot name, which includes
 * every `Object.prototype` member name (`constructor`, `toString`,
 * `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`,
 * `toLocaleString`). A params object built with `Object.fromEntries`
 * inherits `Object.prototype`, so a bracket/dot read for an ABSENT slot of
 * one of those names (e.g. `params.constructor` on a route bound to
 * `/plugin/:constructor`) resolves the inherited member instead of
 * `undefined`. A prototype-less object closes that off at the source: no
 * inherited member exists to read, present or not. This is belt-and-braces
 * alongside `isPresentParamSlot`'s own-property check below (either alone
 * is fragile: this function protects every consumer of the resulting
 * object, including guard code this framework does not control; the
 * own-property check protects the one call site that forgets to build a
 * prototype-less object).
 */
export function toNullProtoParams(
  entries: Iterable<[string, string]>
): Record<string, string> {
  const params: Record<string, string> = Object.create(null);
  for (const [key, value] of entries) {
    params[key] = value;
  }
  return params;
}

/**
 * True iff `slot` is present in `params`: an OWN property (`Object.hasOwn`,
 * never one resolved through the prototype chain) whose value is a
 * non-empty string. Shared by `resolveSocketParams` and `resolveRoomKey`'s
 * required-slot presence checks, so both resolvers agree on what "present"
 * means.
 *
 * `Object.hasOwn` is the check that actually closes the prototype-chain
 * auth bypass (see `toNullProtoParams`'s doc): a bare `!params[slot]`
 * truthiness check reads an inherited `Object.prototype` member for an
 * ABSENT slot named e.g. `constructor`, and that member is a function
 * (truthy), so the slot would wrongly resolve as present. An empty string
 * is still treated as missing (both resolvers pin this in their tests: a
 * well-formed but empty value denies, it is not merely "present but
 * blank"), so this is `hasOwn AND non-empty`, not just `hasOwn`.
 */
export function isPresentParamSlot(
  params: Record<string, string>,
  slot: string
): boolean {
  return Object.hasOwn(params, slot) && params[slot] !== '';
}

// The character class typed-routes.ts's `IsParamName` accepts: one or more
// of [A-Za-z0-9_]. Mirrors that type exactly (not `matchParamSegment`'s
// class, which is the SAME character set but anchored to a whole `:name`
// segment) so `isHazardousColonSegment` below and the type layer can never
// disagree on which names the type layer would claim as a param.
const PARAM_NAME_CLASS = /^[A-Za-z0-9_]+$/;

// Strip a single trailing '?'/'*'/'+' modifier, mirroring typed-routes.ts's
// `StripModifier`.
function stripTrailingModifier(text: string): string {
  return /[?*+]$/.test(text) ? text.slice(0, -1) : text;
}

// True iff the type-level `RouteParams` (typed-routes.ts) would claim a
// param for `segment` via its own UNANCHORED extraction: the text after the
// FIRST ':' in the segment, with a single trailing '?'/'*'/'+' modifier
// stripped, is a non-empty [A-Za-z0-9_]+ name. A TypeScript template-literal
// conditional's `${string}:${infer Param}` resolves `Param` to everything
// after the FIRST ':' in the matched string, so reading from `indexOf(':')`
// here mirrors that resolution exactly.
function typeLayerClaimsParam(segment: string): boolean {
  const colonIndex = segment.indexOf(':');
  if (colonIndex === -1) return false;
  const name = stripTrailingModifier(segment.slice(colonIndex + 1));
  return name.length > 0 && PARAM_NAME_CLASS.test(name);
}

/**
 * True iff `segment` is a `:`-bearing hazard `defineChannel` and
 * `@hono-preact/server`'s route-binding boot check (for a route-BOUND
 * socket/room) must reject. Two shapes:
 *
 * 1. The segment STARTS with `:` (e.g. `:board-id`, `:a.b`) but is not a
 *    conforming `:param` segment (`isConformingParamSegment`): the spelling
 *    unambiguously reads as an attempted `:param`, just with a name outside
 *    `[A-Za-z0-9_]`. preact-iso's own runtime route matcher (`exec`) is
 *    WIDER than this framework's grammar and binds such a segment as a
 *    param at request time regardless of the character class, so leaving it
 *    unrejected means the segment is treated as an inert literal HERE while
 *    a wider matcher elsewhere reads it as a live param.
 * 2. The segment does NOT start with `:` (a namespaced literal like
 *    `metrics:cpu`, the colon following a literal prefix), but the
 *    type-level `RouteParams` would still claim a param for it
 *    (`typeLayerClaimsParam` above). A channel/route spelled this way looks
 *    correctly typed and required, but `interpolatePattern`
 *    (`requiredParamSlots`/`declaredParamSlots`, both anchored to
 *    `isConformingParamSegment`'s grammar) never substitutes it and leaves
 *    the segment literal, so every distinct value collapses onto the one
 *    constant segment.
 *
 * A namespaced literal whose suffix does NOT parse as an identifier (e.g.
 * `notifications:user-alerts`, `chat:lobby-1`, `events:order.created`) is
 * NOT a hazard: `RouteParams` does not claim a param there either (the
 * suffix fails the same character class), so the type layer and
 * `interpolatePattern` already agree the segment is a literal. These are
 * ordinary, working colon-namespaced constant names; rejecting them broke
 * every app that used the convention.
 */
export function isHazardousColonSegment(segment: string): boolean {
  if (!segment.includes(':') || isConformingParamSegment(segment)) {
    return false;
  }
  return segment.startsWith(':') || typeLayerClaimsParam(segment);
}
