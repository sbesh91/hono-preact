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
      // `class M { get id() { return '1' } }`); `Object.hasOwn` only sees
      // OWN properties, so it wrongly dropped a getter-supplied value (a
      // real regression: `buildPath('/user/:id', new M())` returned
      // '/user' instead of '/user/1'). Reading `values[m[1]]` directly and
      // typeof-gating on `'string'` keeps that getter-provided value while
      // still dropping an inherited `Object.prototype` MEMBER for an absent
      // slot of that name: `matchParamSegment`'s grammar accepts any
      // `[A-Za-z0-9_]+` name, which includes every `Object.prototype`
      // member name (`constructor`, `toString`, `valueOf`,
      // `hasOwnProperty`, ...), and a missing slot of one of those names
      // reads the inherited member, which is a FUNCTION -- its `typeof` is
      // `'function'`, not `'string'`, so it is dropped rather than spliced
      // into the path/topic as `function toString() { [native code] }`.
      const value = values[m[1]];
      // Absent, non-string, or empty -> drop the segment (avoids emitting
      // `//`). This does NOT enforce that a required param is present;
      // callers that must reject a missing required value do so
      // themselves: the strict `buildPath` overload enforces required keys
      // at the type level, and `rooms-handler` re-checks required channel
      // segments before trusting the topic. The loose-signature callers
      // (build-path impl, define-channel) accept that an absent/empty
      // required value silently truncates the path.
      return typeof value === 'string' && value !== ''
        ? encodeURIComponent(value)
        : null;
    })
    .filter((seg): seg is string => seg !== null)
    .join('/');
}
