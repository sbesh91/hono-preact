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
      // Absent or empty -> drop the segment. A non-optional param is required by
      // the caller's type, so a missing value here can only be an optional one;
      // an empty string is treated the same to avoid emitting `//`.
      return !value ? null : encodeURIComponent(value);
    })
    .filter((seg): seg is string => seg !== null)
    .join('/');
}
