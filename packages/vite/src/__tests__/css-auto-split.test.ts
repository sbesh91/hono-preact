import { describe, it, expect } from 'vitest';
import {
  attributeRules,
  splitCssByChunkUsage,
  type CssChunkEvidence,
} from '../css-auto-split.js';

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

describe('splitCssByChunkUsage', () => {
  const opts = { minSize: 0 };

  it('moves scoped rules out of the residual and into per-chunk sheets', () => {
    const css =
      '.hx-hero{color:red}.mdx-content{color:blue}.plain-shared{margin:0}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    expect(result.perChunk.get('static/home-abc.js')).toContain('hx-hero');
    expect(result.perChunk.get('static/docs-def.js')).toContain('mdx-content');
    expect(result.residual).toContain('plain-shared');
    expect(result.residual).not.toContain('hx-hero');
    expect(result.residual).not.toContain('mdx-content');
  });

  it('reproduces @media wrappers around scoped rules', () => {
    const css =
      '@media (min-width:600px){.hx-hero{color:red}.zz-none{color:blue}}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    const home = result.perChunk.get('static/home-abc.js');
    expect(home).toMatch(/@media[^{]*\{[^{]*\.hx-hero/);
    expect(home).not.toContain('zz-none');
    expect(result.residual).toContain('zz-none');
  });

  it('keeps @keyframes, @font-face and custom-property rules in the residual', () => {
    const css =
      '@keyframes spin{to{rotate:1turn}}@font-face{font-family:X;src:url(x.woff2)}.hx-hero{color:red}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    expect(result.residual).toContain('@keyframes');
    expect(result.residual).toContain('@font-face');
    expect(result.residual).not.toContain('hx-hero');
  });

  it('re-declares the full top-level layer order at the head of the residual', () => {
    const css =
      '@layer a,b,c;@layer b{.hx-hero{color:red}}@layer c{.plain-shared{margin:0}}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    // Even with the whole @layer b block scoped away, the residual's first
    // declaration establishes a,b,c in monolith order.
    expect(result.residual.startsWith('@layer a,b,c;')).toBe(true);
    const home = result.perChunk.get('static/home-abc.js');
    expect(home).toContain('@layer b');
  });

  it('demotes chunks whose scoped CSS is below minSize back to the residual', () => {
    const css = '.hx-hero{color:red}';
    const result = splitCssByChunkUsage(css, CHUNKS, { minSize: 10_000 });
    expect(result.perChunk.size).toBe(0);
    expect(result.residual).toContain('hx-hero');
  });

  it('confines non-style at-rules to the residual, never per-chunk sheets', () => {
    const css =
      '@keyframes spin{to{rotate:1turn}}@font-face{font-family:X;src:url(x.woff2)}.hx-hero{color:red}.mdx-content{color:blue}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    expect(result.perChunk.size).toBe(2);
    for (const [fileName, sheet] of result.perChunk) {
      expect(sheet, fileName).not.toContain('@keyframes');
      expect(sheet, fileName).not.toContain('@font-face');
    }
    const everything = [result.residual, ...result.perChunk.values()].join(
      '\n'
    );
    expect(everything.split('@keyframes').length - 1).toBe(1);
    expect(everything.split('@font-face').length - 1).toBe(1);
  });

  it('reproduces @container wrappers and keeps owners indexing aligned', () => {
    const css =
      '@container (min-width:400px){.hx-hero{color:red}}.mdx-content{color:blue}.plain-shared{margin:0}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    const home = result.perChunk.get('static/home-abc.js');
    expect(home).toMatch(/@container[^{]*\{.*\.hx-hero/);
    expect(result.perChunk.get('static/docs-def.js')).toContain('mdx-content');
    expect(result.residual).toContain('plain-shared');
    expect(result.residual).not.toContain('hx-hero');
  });

  it('compares minSize against UTF-8 bytes, not UTF-16 code units', () => {
    // The check marks are multi-byte in UTF-8 but one code unit each in
    // UTF-16, so byte length exceeds string length; a threshold between the
    // two keeps the sheet only if the splitter measures bytes.
    const css = '.hx-hero{--check:"✓✓✓✓"}';
    const probe = splitCssByChunkUsage(css, CHUNKS, { minSize: 0 });
    const sheet = probe.perChunk.get('static/home-abc.js');
    expect(sheet).toBeDefined();
    if (sheet === undefined) return;
    const units = sheet.length;
    const bytes = Buffer.byteLength(sheet, 'utf8');
    expect(bytes).toBeGreaterThan(units);
    const kept = splitCssByChunkUsage(css, CHUNKS, { minSize: units + 1 });
    expect(kept.perChunk.get('static/home-abc.js')).toBe(sheet);
    const demoted = splitCssByChunkUsage(css, CHUNKS, { minSize: bytes + 1 });
    expect(demoted.perChunk.size).toBe(0);
    expect(demoted.residual).toContain('hx-hero');
  });

  it('keeps nested @layer statements in the residual', () => {
    // Only TOP-LEVEL layer names are re-declared by the residual's prefix, so
    // a statement nested under a conditional at-rule must survive in place.
    const css = '@media (min-width:600px){@layer x;.plain-shared{margin:0}}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    expect(result.residual).toContain('@layer x');
  });

  it('conserves every rule exactly once across outputs', () => {
    const css = [
      '@layer theme,base;',
      ':root{--t:1}',
      '.hx-hero{color:red}',
      '@media (min-width:600px){.hx-card{color:blue}.mdx-content{margin:0}}',
      '.plain-shared{padding:0}',
    ].join('');
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    const everything = [result.residual, ...result.perChunk.values()].join(
      '\n'
    );
    for (const marker of [
      '--t:1',
      'hx-hero',
      'hx-card',
      'mdx-content',
      'plain-shared',
    ]) {
      const count = everything.split(marker).length - 1;
      expect(count, marker).toBe(1);
    }
  });
});
