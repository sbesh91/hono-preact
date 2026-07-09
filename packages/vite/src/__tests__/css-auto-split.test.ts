import { describe, it, expect } from 'vitest';
import { attributeRules, type CssChunkEvidence } from '../css-auto-split.js';

const chunk = (
  fileName: string,
  code: string,
  scopable = true
): CssChunkEvidence => ({ fileName, code, scopable });

const HOME = chunk('static/home-abc.js', 'x("hx-hero");y("hx-card")');
const DOCS = chunk('static/docs-def.js', 'x("mdx-content")');
const ENTRY = chunk('static/client.js', 'x("app-shell")', false);
const CHUNKS = [HOME, DOCS, ENTRY];

describe('attributeRules', () => {
  it('scopes a rule whose classes are exclusive to one scopable chunk', () => {
    const { owners } = attributeRules('.hx-hero{color:red}', CHUNKS, undefined);
    expect(owners).toEqual(['static/home-abc.js']);
  });

  it('keeps a rule global when its class appears in more than one chunk', () => {
    const shared = [...CHUNKS, chunk('static/other-x.js', 'z("hx-hero")')];
    const { owners } = attributeRules('.hx-hero{color:red}', shared, undefined);
    expect(owners).toEqual([null]);
  });

  it('keeps zero-evidence classes global (never drops)', () => {
    const { owners } = attributeRules(
      '.runtime-only{color:red}',
      CHUNKS,
      undefined
    );
    expect(owners).toEqual([null]);
  });

  it('keeps classless selectors global (:root, elements, view transitions)', () => {
    const css =
      ':root{--t:1}p{margin:0}::view-transition-group(x){animation:none}';
    const { owners } = attributeRules(css, CHUNKS, undefined);
    expect(owners).toEqual([null, null, null]);
  });

  it('keeps rules owned by entry-closure (non-scopable) chunks global', () => {
    const { owners } = attributeRules(
      '.app-shell{color:red}',
      CHUNKS,
      undefined
    );
    expect(owners).toEqual([null]);
  });

  it('requires an anchor class outside functional pseudo-classes', () => {
    // .hx-hero anchors; the :not() argument only adds evidence requirements.
    const scoped = attributeRules(
      '.hx-hero:not(.hx-card){color:red}',
      CHUNKS,
      undefined
    );
    expect(scoped.owners).toEqual(['static/home-abc.js']);
    // div:not(.hx-hero) has no anchor: matching elements need not carry the class.
    const anchorless = attributeRules(
      'div:not(.hx-hero){color:red}',
      CHUNKS,
      undefined
    );
    expect(anchorless.owners).toEqual([null]);
  });

  it('demotes when classes span two chunks, and when a selector list mixes routes', () => {
    const span = attributeRules(
      '.hx-hero .mdx-content{color:red}',
      CHUNKS,
      undefined
    );
    expect(span.owners).toEqual([null]);
    const list = attributeRules(
      '.hx-hero,.mdx-content{color:red}',
      CHUNKS,
      undefined
    );
    expect(list.owners).toEqual([null]);
  });

  it('indexes only top-level style rules; nested rules follow their parent', () => {
    const css = '.hx-hero{color:red;&:hover{color:blue}}';
    const { owners } = attributeRules(css, CHUNKS, undefined);
    expect(owners).toEqual(['static/home-abc.js']);
  });

  it('collects top-level layer order from statements and blocks', () => {
    const css =
      '@layer theme,base;@layer base{.hx-hero{color:red}}@layer utilities{.u{margin:0}}';
    const { layerNames } = attributeRules(css, CHUNKS, undefined);
    expect(layerNames).toEqual(['theme', 'base', 'utilities']);
  });

  it('attributes rules inside @media by their classes', () => {
    const css = '@media (min-width:600px){.hx-card{color:red}}';
    const { owners } = attributeRules(css, CHUNKS, undefined);
    expect(owners).toEqual(['static/home-abc.js']);
  });
});
