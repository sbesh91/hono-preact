function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

/**
 * True when `urlPath` (the concrete URL the user navigated to, with all
 * params substituted) matches `pattern`. Mirrors preact-iso's `exec` route
 * grammar so the server resolver agrees with the client router:
 *
 *   literal   segment must equal the URL segment
 *   :param    required single segment (needs a value)
 *   :param?   optional single segment (matches with or without a value)
 *   :param*   rest, zero-or-more trailing segments (matches an empty remainder)
 *   :param+   rest, one-or-more trailing segments (needs at least one)
 *   *         matches the entire remainder, including none; later pattern
 *             segments are ignored
 *
 * Absent a rest/optional/`*` segment, the segment counts must be equal. Used
 * at lookup time; callers resolve the URL to the most specific matching
 * pattern in their map via `findBestPattern`.
 */
export function urlPathMatchesPattern(
  urlPath: string,
  pattern: string
): boolean {
  const ps = segmentsOf(pattern);
  const us = segmentsOf(urlPath);
  const len = Math.max(ps.length, us.length);
  for (let i = 0; i < len; i++) {
    const p = ps[i];
    const u = us[i];
    // More URL segments than the pattern accounts for (and no `*`/rest
    // segment consumed the remainder): not a match.
    if (p === undefined) return false;
    // A bare `*` matches the entire remainder, including none.
    if (p === '*') return true;
    if (p.startsWith(':')) {
      const flag = p[p.length - 1];
      if (u === undefined) {
        // No URL segment here. Optional (`?`) skips to the next segment;
        // rest-zero-or-more (`*`) matches the (empty) remainder; a required
        // `:param` or one-or-more `:param+` does not match.
        if (flag === '?') continue;
        if (flag === '*') return true;
        return false;
      }
      // A URL segment is present; `*`/`+` consume the whole remainder.
      if (flag === '*' || flag === '+') return true;
      continue;
    }
    // Literal segment must equal the URL segment.
    if (p !== u) return false;
  }
  return true;
}

/**
 * Score a route pattern's specificity; findBestPattern uses this as the primary
 * ranking when multiple patterns match the URL. Mirrors preact-iso's runtime
 * preference for literal segments: literal=2, param=1, wildcard=0. Within
 * the same score, `findBestPattern` falls back to depth, and within the
 * same depth, to iteration order. A literal pattern such as /admin/users/me
 * wins over `/admin/users/:id` when the URL is `/admin/users/me`.
 */
export function patternScore(pattern: string): number {
  let score = 0;
  for (const seg of segmentsOf(pattern)) {
    if (seg === '*') score += 0;
    else if (seg.startsWith(':')) score += 1;
    else score += 2;
  }
  return score;
}

/**
 * Pick the best-matching pattern for a concrete URL path. Tiebreaker:
 * (1) higher specificity score (literal=2, param=1, wildcard=0);
 * (2) within the same score, more segments; (3) within the same depth,
 * first in iteration order. Returns null when nothing matches.
 *
 * NOTE: O(patterns) linear scan. Fine for small apps; a precomputed trie
 * or a request-keyed memo would help at scale.
 */
export function findBestPattern(
  patterns: Iterable<string>,
  urlPath: string
): string | null {
  let bestPattern: string | null = null;
  let bestScore = -1;
  let bestDepth = -1;
  for (const pattern of patterns) {
    if (!urlPathMatchesPattern(urlPath, pattern)) continue;
    const score = patternScore(pattern);
    const depth = segmentsOf(pattern).length;
    if (score > bestScore || (score === bestScore && depth > bestDepth)) {
      bestPattern = pattern;
      bestScore = score;
      bestDepth = depth;
    }
  }
  return bestPattern;
}
