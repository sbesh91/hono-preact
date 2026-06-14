/**
 * Pure generator for the docs-site LLM artifacts (llms.txt / llms-full.txt).
 *
 * It reads the docs MDX off disk and the curated index from nav.ts, and returns
 * two strings. It is deliberately free of any output-path knowledge so it can be
 * unit-tested; the Vite plugin in vite.config.ts owns where the files land.
 */

/**
 * Convert an MDX docs page into plain Markdown for the LLM corpus. Strips the
 * docs-site JSX wrappers while preserving prose, code fences, GFM tables, and
 * headings. <Example> blocks wrap interactive demo *components* (e.g.
 * <DialogDemo />), not instructive source, so they are dropped; the usable code
 * lives in the page's own fenced blocks and <CodeTabs>.
 */
export function mdxToMarkdown(source: string): string {
  let md = source;

  // 1. Drop top-of-file import lines (component pages import their demos).
  md = md.replace(/^import\s.*?;?\s*$/gm, '');

  // 2. Remove <Example>...</Example> blocks entirely.
  md = md.replace(/<Example>[\s\S]*?<\/Example>/g, '');

  // 3. Unwrap <CodeTabs ...> ... </CodeTabs>, keeping the fenced blocks inside
  //    (each already carries its language tag, e.g. ```css / ```tsx).
  md = md.replace(/<CodeTabs[^>]*>/g, '').replace(/<\/CodeTabs>/g, '');

  // 4. Drop any remaining standalone self-closing custom-component tags
  //    (capitalized component name), e.g. a bare <SafeAreaDiagram />.
  md = md.replace(/^\s*<[A-Z][A-Za-z0-9]*(\s[^>]*)?\/>\s*$/gm, '');

  // 5. Collapse the runs of blank lines the strips leave behind.
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim() + '\n';
}

/**
 * The one-line description for a page: its lead paragraph (the first prose block
 * after the H1). The docs template already requires this paragraph, so it is the
 * truest "next to the page" source and cannot drift.
 */
export function extractDescription(markdown: string): string {
  // Everything after the first H1 line.
  const afterH1 = markdown.replace(/^[\s\S]*?^#\s+.+$/m, '');
  for (const block of afterH1.split(/\n\s*\n/)) {
    const line = block.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue; // heading
    if (line.startsWith('```')) continue; // code fence
    if (line.startsWith('|')) continue; // table
    if (line.startsWith('<')) continue; // leftover JSX
    return line.replace(/\s+/g, ' ');
  }
  return '';
}

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NavArea } from '../pages/docs/nav.js';

const SITE_ORIGIN = 'https://framework.sbesh.com';
const SUMMARY =
  'A small full-stack framework: Hono on the server, Preact in the browser, ' +
  'routes declared in code, typed loaders/actions/guards, streaming everywhere.';

export interface LlmsFiles {
  llmsTxt: string;
  llmsFullTxt: string;
}

/** Map a `/docs/...` route back to the MDX file that serves it, or null. */
export function routeToFile(docsDir: string, route: string): string | null {
  const slug = route === '/docs' ? '' : route.replace(/^\/docs\//, '');
  const direct =
    slug === '' ? join(docsDir, 'index.mdx') : join(docsDir, `${slug}.mdx`);
  if (existsSync(direct)) return direct;
  const indexed = join(docsDir, slug, 'index.mdx');
  if (existsSync(indexed)) return indexed;
  return null;
}

/** Build the llms.txt (curated index) and llms-full.txt (full corpus) strings. */
export function generateLlmsFiles(nav: NavArea[], docsDir: string): LlmsFiles {
  const indexLines: string[] = ['# hono-preact', '', `> ${SUMMARY}`, ''];
  const corpusParts: string[] = [];

  for (const area of nav) {
    for (const section of area.sections) {
      indexLines.push(`## ${section.heading}`, '');
      for (const entry of section.entries) {
        const file = routeToFile(docsDir, entry.route);
        if (!file) {
          throw new Error(
            `llms.txt: nav route ${entry.route} (${entry.title}) has no matching MDX file under ${docsDir}`
          );
        }
        const markdown = mdxToMarkdown(readFileSync(file, 'utf8'));
        const url = `${SITE_ORIGIN}${entry.route}`;
        const description = extractDescription(markdown);
        indexLines.push(
          description
            ? `- [${entry.title}](${url}): ${description}`
            : `- [${entry.title}](${url})`
        );
        corpusParts.push(`> Source: ${url}\n\n${markdown}`);
      }
      indexLines.push('');
    }
  }

  indexLines.push(
    '## Full corpus',
    '',
    `- [Complete documentation](${SITE_ORIGIN}/llms-full.txt): every page above concatenated as one file`,
    ''
  );

  return {
    llmsTxt:
      indexLines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd() + '\n',
    llmsFullTxt: corpusParts.join('\n\n---\n\n').trimEnd() + '\n',
  };
}
