// Substitute `:param` segments in a `/`-delimited pattern with their values.
// Shared by `build-path.ts` (route paths) and `define-channel.ts` (channel
// topics) so both interpolate identically: the same `[A-Za-z0-9_]` name class,
// the same single optional `?*+` modifier, the same drop-absent-segment and
// url-encode rules. The runtime matcher (preact-iso's `exec`) only treats
// `:name` (name in `[A-Za-z0-9_]+`, optional trailing `?`/`*`/`+`) as a param;
// anything else is a literal segment kept verbatim.
export function interpolatePattern(
  pattern: string,
  values: Record<string, string | undefined>
): string {
  return pattern
    .split('/')
    .map((seg) => {
      const m = /^:([A-Za-z0-9_]+)[?*+]?$/.exec(seg);
      if (!m) return seg; // static segment, kept verbatim
      const value = values[m[1]];
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
