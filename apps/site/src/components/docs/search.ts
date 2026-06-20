import type { DocPage } from '../../llms/generate-docs-index.js';

export type SearchResult = { href: string; title: string; section?: string };

/**
 * Subsequence fuzzy score. Returns null when `query` is not a subsequence of
 * `text`; otherwise a higher number for tighter, earlier matches. Both args are
 * expected lowercased.
 */
export function fuzzyScore(text: string, query: string): number | null {
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const qc of query) {
    let found = -1;
    for (let i = ti; i < text.length; i++) {
      if (text[i] === qc) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    if (found === 0) score += 10; // start-of-string bonus
    if (found === ti) {
      streak += 1;
      score += 5 + streak; // contiguous run
    } else {
      streak = 0;
      score += 1;
    }
    ti = found + 1;
  }
  return score;
}

/**
 * Search page titles and section headings. Empty query lists every page (title
 * only) so the palette doubles as a page browser. Results are ranked by fuzzy
 * match quality; a page (title) result wins over a section (heading) result only
 * on an equal score, so an incidental title subsequence cannot bury a strong
 * heading match. Capped at `limit`.
 */
export function searchDocs(
  pages: DocPage[],
  query: string,
  limit = 50
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return pages.slice(0, limit).map((p) => ({ href: p.route, title: p.title }));
  }
  const scored: { r: SearchResult; score: number; isTitle: boolean }[] = [];
  for (const p of pages) {
    const ts = fuzzyScore(p.title.toLowerCase(), q);
    if (ts != null) {
      scored.push({
        r: { href: p.route, title: p.title },
        score: ts,
        isTitle: true,
      });
    }
    for (const h of p.headings) {
      const hs = fuzzyScore(h.text.toLowerCase(), q);
      if (hs != null) {
        scored.push({
          r: { href: `${p.route}#${h.id}`, title: p.title, section: h.text },
          score: hs,
          isTitle: false,
        });
      }
    }
  }
  // Best fuzzy match first; on a tie, prefer the page (title) over a section.
  scored.sort(
    (a, b) => b.score - a.score || Number(b.isTitle) - Number(a.isTitle)
  );
  return scored.slice(0, limit).map((s) => s.r);
}
