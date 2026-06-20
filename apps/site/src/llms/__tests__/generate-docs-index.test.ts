import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import {
  headingText,
  parseHeadings,
  headingsForPage,
  generateDocsIndex,
  headingsForRoute,
} from '../generate-docs-index.js';
import { nav } from '../../pages/docs/nav.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../../pages/docs');

describe('headingText', () => {
  it('strips inline code backticks, links, and emphasis to visible text', () => {
    expect(headingText('`loader.View()` (form)')).toBe('loader.View() (form)');
    expect(headingText('See [Streaming](/docs/streaming)')).toBe(
      'See Streaming'
    );
    expect(headingText('**Bold** and _italic_')).toBe('Bold and italic');
  });
});

describe('parseHeadings', () => {
  it('collects ## and ### headings but ignores # inside fenced code', () => {
    const src = [
      '# Title',
      '',
      '## First',
      '',
      '```sh',
      '# not a heading',
      '```',
      '',
      '### Second',
    ].join('\n');
    expect(parseHeadings(src)).toEqual([
      { depth: 1, text: 'Title' },
      { depth: 2, text: 'First' },
      { depth: 3, text: 'Second' },
    ]);
  });
});

describe('headingsForPage', () => {
  it('keeps only h2/h3 and assigns github-slugger ids', () => {
    const src = '# T\n\n## Alpha\n\n### Beta\n';
    expect(headingsForPage(src)).toEqual([
      { text: 'Alpha', id: 'alpha', depth: 2 },
      { text: 'Beta', id: 'beta', depth: 3 },
    ]);
  });

  it('dedupes repeated heading text the way rehype-slug does', () => {
    const src = '# T\n\n## Options\n\n## Options\n';
    expect(headingsForPage(src).map((h) => h.id)).toEqual([
      'options',
      'options-1',
    ]);
  });

  it('matches github-slugger on a real heading with code and punctuation', () => {
    const src =
      '# T\n\n### `loader.View(render, { initial, reduce })` (accumulating form)\n';
    const expected = new GithubSlugger().slug(
      'loader.View(render, { initial, reduce }) (accumulating form)'
    );
    expect(headingsForPage(src)[0].id).toBe(expected);
  });
});

describe('generateDocsIndex', () => {
  const pages = generateDocsIndex(nav, docsDir);

  it('produces one page per nav entry', () => {
    const routeCount = nav.flatMap((a) =>
      a.sections.flatMap((s) => s.entries)
    ).length;
    expect(pages).toHaveLength(routeCount);
  });

  it('captures the .View() options heading on live-loaders with a parity slug', () => {
    const page = pages.find((p) => p.route === '/docs/live-loaders')!;
    const h = page.headings.find((x) => x.text.includes('loader.View'))!;
    expect(h).toBeTruthy();
    // headingText must strip the backticks/markdown from the real doc heading:
    const expectedText =
      'loader.View(render, { initial, reduce }) (accumulating form)';
    expect(h.text).toBe(expectedText);
    // and the slug must equal github-slugger on that known visible text (real parity):
    expect(h.id).toBe(new GithubSlugger().slug(expectedText));
  });
});

describe('headingsForRoute', () => {
  it('returns a known route headings and empty for unknown', () => {
    const pages = generateDocsIndex(nav, docsDir);
    expect(headingsForRoute(pages, '/docs/loaders').length).toBeGreaterThan(0);
    expect(headingsForRoute(pages, '/docs/nope')).toEqual([]);
  });
});
