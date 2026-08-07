// The docs corpus, in the two forms the coverage gates need.
//
// Shared by `exports-coverage.test.ts` and `type-members-coverage.test.ts` so
// there is ONE definition of "cited in the docs". They diverged once: the
// type-member gate was hardened to code spans in #354 while the export gate kept
// matching whole-page prose, which is how `Show` passed on the English word
// "Show" starting an unrelated sentence.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The code spans of one page: fenced blocks, inline spans, and table rows.
 *
 * A markdown TABLE ROW counts as one span even though each cell is its own
 * inline span, because the reference tables cite a symbol in one column and
 * describe it in another; splitting them would read every table-documented
 * symbol as undocumented.
 */
export function codeSpansOf(raw: string): string[] {
  const spans: string[] = [];
  for (const m of raw.matchAll(/```[\s\S]*?```/g)) spans.push(m[0]);
  for (const m of raw.matchAll(/`[^`\n]+`/g)) spans.push(m[0]);
  for (const m of raw.matchAll(/^\|.*\|$/gm)) spans.push(m[0]);
  return spans;
}

/** Every `.mdx` page under `docsDir`, excluding `__tests__`. */
export function readDocsPages(docsDir: string): string[] {
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(resolve(dir, entry.name));
      } else if (entry.name.endsWith('.mdx')) {
        pages.push(readFileSync(resolve(dir, entry.name), 'utf8'));
      }
    }
  };
  walk(docsDir);
  return pages;
}

/** Every code span across every docs page. */
export function readCodeSpans(docsDir: string): string[] {
  return readDocsPages(docsDir).flatMap(codeSpansOf);
}

/**
 * Is `name` cited as CODE anywhere in `spans`?
 *
 * Code-only on purpose. Export and member names are ordinary English often
 * enough (`signal`, `effect`, `batch`, `value`, `send`, `close`, `Show`) that a
 * whole-page prose match calls them documented on sight, which is the failure
 * this replaces. Prose that discusses a symbol without ever writing it as code
 * is not a reference a reader can use anyway.
 */
export function isCitedInCode(name: string, spans: readonly string[]): boolean {
  const re = new RegExp(`\\b${name}\\b`);
  return spans.some((span) => re.test(span));
}
