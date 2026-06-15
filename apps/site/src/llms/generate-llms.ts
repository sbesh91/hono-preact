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

  // Multi-line wrapper strips run globally: these tokens never appear inside
  // fenced code in the docs.
  // Remove <Example>...</Example> blocks entirely (they wrap interactive demo
  // components, not instructive source).
  md = md.replace(/<Example>[\s\S]*?<\/Example>/g, '');
  // Unwrap <CodeTabs ...> ... </CodeTabs>, keeping the fenced blocks inside.
  md = md.replace(/<CodeTabs[^>]*>/g, '').replace(/<\/CodeTabs>/g, '');

  // Line-oriented strips must NOT touch fenced code: a ```ts block legitimately
  // contains `import ...` lines and standalone <Foo /> JSX. Apply them only to
  // the prose segments between fences.
  md = mapNonFencedSegments(md, (text) =>
    text
      // Drop top-of-file import lines (component pages import their demos).
      .replace(/^import\s.*?;?\s*$/gm, '')
      // Drop standalone self-closing custom-component tags, e.g. <SafeAreaDiagram />.
      .replace(/^\s*<[A-Z][A-Za-z0-9]*(\s[^>]*)?\/>\s*$/gm, '')
  );

  // Collapse the runs of blank lines the strips leave behind.
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim() + '\n';
}

/**
 * Apply `fn` to the parts of `md` that are NOT inside a fenced code block.
 * Splitting on a capturing group yields alternating prose (even indices) and
 * fenced (odd indices) segments.
 */
function mapNonFencedSegments(
  md: string,
  fn: (text: string) => string
): string {
  const parts = md.split(/(^```[\s\S]*?^```|^~~~[\s\S]*?^~~~)/m);
  return parts.map((part, i) => (i % 2 === 0 ? fn(part) : part)).join('');
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
    if (line.startsWith('>')) continue; // blockquote
    if (line.startsWith('-') || line.startsWith('*')) continue; // list item
    // Flatten, reduce markdown links to their text, keep the first sentence.
    const flat = line
      .replace(/\s+/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    const firstSentence = flat.match(/^.*?[.!?](?=\s|$)/);
    return (firstSentence ? firstSentence[0] : flat).trim();
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
