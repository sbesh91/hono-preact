/**
 * Build-time generator for the docs heading index that powers the on-this-page
 * TOC and the Cmd+K palette. It reads the same MDX off disk as generate-llms,
 * and assigns slug ids with github-slugger so they match the ids rehype-slug
 * stamps onto the rendered headings (see src/mdx-plugins.ts). Kept free of any
 * Vite/output knowledge so it is unit-testable; the virtual-module plugin owns
 * how it reaches the client.
 */
import { readFileSync } from 'node:fs';
import GithubSlugger from 'github-slugger';
import type { NavArea } from '../pages/docs/nav.js';
import { routeToFile } from './generate-llms.js';
import type { DocHeading, DocPage } from './docs-index.js';

export type { DocHeading, DocPage } from './docs-index.js';
export { headingsForRoute } from './docs-index.js';

/** Reduce a markdown heading to the visible text rehype-slug would slug. */
export function headingText(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, '$1') // inline code -> its text (preserves <...> inside)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/[*_~]+/g, '') // emphasis markers
    .replace(/\s+/g, ' ')
    .trim();
}

/** All `#`..`######` headings in document order, skipping fenced code blocks. */
export function parseHeadings(
  source: string
): { depth: number; text: string }[] {
  const out: { depth: number; text: string }[] = [];
  let inFence = false;
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) out.push({ depth: m[1].length, text: headingText(m[2]) });
  }
  return out;
}

/**
 * The h2/h3 headings of one page with rehype-slug-compatible ids. Every heading
 * (including the h1) is fed through one github-slugger instance in document
 * order so the duplicate-suffix counter matches rehype-slug's per-document pass.
 */
export function headingsForPage(source: string): DocHeading[] {
  const slugger = new GithubSlugger();
  const out: DocHeading[] = [];
  for (const h of parseHeadings(source)) {
    const id = slugger.slug(h.text);
    if (h.depth === 2 || h.depth === 3) {
      out.push({ text: h.text, id, depth: h.depth });
    }
  }
  return out;
}

/** Build the heading index for every nav entry. */
export function generateDocsIndex(nav: NavArea[], docsDir: string): DocPage[] {
  const pages: DocPage[] = [];
  for (const area of nav) {
    for (const section of area.sections) {
      for (const entry of section.entries) {
        const file = routeToFile(docsDir, entry.route);
        if (!file) {
          throw new Error(
            `docs-index: nav route ${entry.route} (${entry.title}) has no matching MDX file under ${docsDir}`
          );
        }
        pages.push({
          title: entry.title,
          route: entry.route,
          headings: headingsForPage(readFileSync(file, 'utf8')),
        });
      }
    }
  }
  return pages;
}
