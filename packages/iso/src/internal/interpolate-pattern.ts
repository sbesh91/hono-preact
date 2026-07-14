import { matchParamSegment } from './param-slots.js';

// Substitute `:param` segments in a `/`-delimited pattern with their values.
// Shared by `build-path.ts` (route paths) and `define-channel.ts` (channel
// topics) so both interpolate identically: `matchParamSegment` (param-slots.ts)
// is this framework's ONE ':param' grammar definition, imported here rather
// than re-spelled, so this function's notion of a param segment can never
// disagree with `requiredParamSlots`/`declaredParamSlots`. The runtime matcher
// (preact-iso's `exec`) only treats `:name` (name in `[A-Za-z0-9_]+`, optional
// trailing `?`/`*`/`+`) as a param; anything else is a literal segment kept
// verbatim.
export function interpolatePattern(
  pattern: string,
  values: Record<string, string | undefined>
): string {
  return pattern
    .split('/')
    .map((seg) => {
      const m = matchParamSegment(seg);
      if (!m) return seg; // static segment, kept verbatim
      // Own-property read only, never one resolved through the prototype
      // chain. `matchParamSegment`'s grammar accepts any `[A-Za-z0-9_]+`
      // name, which includes every `Object.prototype` member name
      // (`constructor`, `toString`, `valueOf`, `hasOwnProperty`, ...). A
      // bare `values[m[1]]` read for an ABSENT slot of one of those names
      // would resolve the inherited member (a function, always truthy)
      // instead of `undefined`, splicing e.g. `function toString() {
      // [native code] }` into the interpolated path/topic rather than
      // dropping the segment.
      const value = Object.hasOwn(values, m[1]) ? values[m[1]] : undefined;
      // Absent or empty -> drop the segment (avoids emitting `//`). This does
      // NOT enforce that a required param is present; callers that must reject a
      // missing required value do so themselves: the strict `buildPath` overload
      // enforces required keys at the type level, and `rooms-handler` re-checks
      // required channel segments before trusting the topic. The loose-signature
      // callers (build-path impl, define-channel) accept that an absent/empty
      // required value silently truncates the path.
      return !value ? null : encodeURIComponent(value);
    })
    .filter((seg): seg is string => seg !== null)
    .join('/');
}
