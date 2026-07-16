import { matchParamSegment } from './param-slots.js';

// Substitute `:param` segments in a `/`-delimited pattern with their values.
// Shared by `build-path.ts` (route paths) and `define-channel.ts` (channel
// topics) so both interpolate identically: `matchParamSegment` (param-slots.ts)
// is this framework's ONE ':param' grammar definition, imported here rather
// than re-spelled, so this function's notion of a param segment can never
// disagree with `requiredParamSlots`/`declaredParamSlots`. This framework's
// OWN supported grammar treats `:name` (name in `[A-Za-z0-9_]+`, optional
// trailing `?`/`*`/`+`) as a param; anything else is a literal segment kept
// verbatim. The runtime matcher (preact-iso's `exec`) is WIDER: it binds ANY
// `:`-prefixed segment as a param regardless of the name's character class
// (hyphens, dots, extra colons all bind fine), so a spelling this grammar
// rejects can still be live over plain HTTP. See `guardReadableParamSlots`
// (param-slots.ts) for the fuller account of that divergence: it is why
// `defineChannel` and the bound-route boot check reject the disagreeing
// spellings (`isHazardousColonSegment`) rather than trusting this narrower
// grammar alone.
export function interpolatePattern(
  pattern: string,
  values: Record<string, string | undefined>
): string {
  return pattern
    .split('/')
    .map((seg) => {
      const m = matchParamSegment(seg);
      if (!m) return seg; // static segment, kept verbatim
      // A plain property read, not an own-property check. `values` may be a
      // class instance whose param is supplied via a PROTOTYPE getter (e.g.
      // `class M { get id() { return '1' } }`); an own-property check
      // (`Object.hasOwn`) wrongly dropped a getter-supplied value.
      const value = values[m[1]];
      // Falsy (absent / empty string) -> drop the segment (avoids emitting
      // `//`). A FUNCTION value is also dropped, as pure insurance: after the
      // reserved-name rejection at DEFINITION time (`isReservedParamName` in
      // `defineRoutes` / `assertConformingChannelName`), `m[1]` can never be an
      // `Object.prototype` member for a real declared route/channel, so
      // `values[m[1]]` can never resolve an inherited function here; the drop
      // merely guarantees a function is never spliced into a path/topic even
      // for a directly-built pattern. Any other value (a string, or a number
      // coerced by `encodeURIComponent`) is kept, matching the pre-hardening
      // behavior; an earlier `typeof value === 'string'` gate wrongly dropped
      // numeric and getter-provided values. This does NOT enforce that a
      // required param is present; callers that must reject a missing required
      // value do so themselves (the strict `buildPath` overload at the type
      // level, `rooms-handler` re-checking required channel segments).
      return !value || typeof value === 'function'
        ? null
        : encodeURIComponent(value);
    })
    .filter((seg): seg is string => seg !== null)
    .join('/');
}
