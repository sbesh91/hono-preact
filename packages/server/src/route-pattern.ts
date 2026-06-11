function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

/**
 * True when `urlPath` (the concrete URL the user navigated to, with all
 * params substituted) matches `pattern` exactly: same segment count, and
 * each pattern segment either equals the URL segment, is a `:param`, or is
 * a trailing `*`.
 *
 * Used at lookup time. Callers resolve the URL to the most specific
 * pattern in their map via `findBestPattern`.
 */
export function urlPathMatchesPattern(
  urlPath: string,
  pattern: string
): boolean {
  const ps = segmentsOf(pattern);
  const us = segmentsOf(urlPath);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p === '*') return true;
    if (i >= us.length) return false;
    if (p.startsWith(':')) continue;
    if (p !== us[i]) return false;
  }
  return ps.length === us.length;
}

/**
 * Score a route pattern for tiebreaker purposes when multiple patterns at
 * the same segment depth match the URL. Mirrors preact-iso's runtime
 * preference for literal segments: literal=2, param=1, wildcard=0. Within
 * the same score, `findBestPattern` falls back to depth, and within the
 * same depth, to iteration order. Pre-merged literal wins over
 * `/admin/users/:id` when the URL is `/admin/users/me`.
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
