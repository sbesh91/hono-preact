import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mdxToMarkdown, extractDescription } from '../generate-llms.js';
import { nav } from '../../pages/docs/nav.js';
import { routeToFile, generateLlmsFiles } from '../generate-llms.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../../pages/docs');

describe('mdxToMarkdown', () => {
  it('strips top-of-file import lines', () => {
    const out = mdxToMarkdown(
      `import { Foo } from './Foo.js';\n\n# Title\n\nBody.`
    );
    expect(out).not.toContain('import');
    expect(out).toContain('# Title');
    expect(out).toContain('Body.');
  });

  it('drops <Example> blocks (they wrap interactive demo components)', () => {
    const out = mdxToMarkdown(
      `# T\n\n<Example>\n  <DialogDemo />\n</Example>\n\nAfter.`
    );
    expect(out).not.toContain('<Example>');
    expect(out).not.toContain('DialogDemo');
    expect(out).toContain('After.');
  });

  it('unwraps <CodeTabs> but keeps the fenced code inside', () => {
    const src = `# T\n\n<CodeTabs labels={['CSS', 'Tailwind']}>\n\n\`\`\`css\na { color: red; }\n\`\`\`\n\n</CodeTabs>\n`;
    const out = mdxToMarkdown(src);
    expect(out).not.toContain('CodeTabs');
    expect(out).toContain('```css');
    expect(out).toContain('a { color: red; }');
  });

  it('preserves prose, headings, tables, and fenced code', () => {
    const src = `# T\n\nLead.\n\n## H2\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n`;
    const out = mdxToMarkdown(src);
    expect(out).toContain('## H2');
    expect(out).toContain('| a | b |');
    expect(out).toContain('const x = 1;');
  });
});

describe('extractDescription', () => {
  it('returns the first prose paragraph after the H1, flattened to one line', () => {
    const md = `# Server Loaders\n\nLoaders run on the server\nbefore render.\n\n## Next\n`;
    expect(extractDescription(md)).toBe(
      'Loaders run on the server before render.'
    );
  });

  it('returns empty string when there is no lead paragraph', () => {
    expect(extractDescription(`# Title\n\n## Straight to a heading\n`)).toBe(
      ''
    );
  });
});

describe('routeToFile', () => {
  it('resolves a top-level guide route', () => {
    expect(routeToFile(docsDir, '/docs/loaders')).toMatch(/loaders\.mdx$/);
  });
  it('resolves an area-root route to its index.mdx', () => {
    expect(routeToFile(docsDir, '/docs/components')).toMatch(
      /components\/index\.mdx$/
    );
  });
  it('returns null for an unknown route', () => {
    expect(routeToFile(docsDir, '/docs/does-not-exist')).toBeNull();
  });
});

describe('generateLlmsFiles', () => {
  const { llmsTxt, llmsFullTxt } = generateLlmsFiles(nav, docsDir);

  it('every nav route resolves to a real MDX file', () => {
    const routes = nav.flatMap((a) =>
      a.sections.flatMap((s) => s.entries.map((e) => e.route))
    );
    for (const route of routes) {
      expect(routeToFile(docsDir, route), `route ${route}`).not.toBeNull();
    }
  });

  it('llms.txt has the expected header and a known annotated link', () => {
    expect(llmsTxt.startsWith('# hono-preact')).toBe(true);
    expect(llmsTxt).toContain('> ');
    expect(llmsTxt).toContain('## ');
    expect(llmsTxt).toContain('](https://framework.sbesh.com/docs/loaders)');
  });

  it('llms-full.txt is non-empty, includes real page content, and has no leftover JSX', () => {
    expect(llmsFullTxt.length).toBeGreaterThan(1000);
    expect(llmsFullTxt).toContain('# Server Loaders');
    expect(llmsFullTxt).not.toContain('<Example>');
    expect(llmsFullTxt).not.toContain('<CodeTabs');
  });
});
