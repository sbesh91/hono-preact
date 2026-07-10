import { describe, it, expect } from 'vitest';
import { transform } from 'lightningcss';
import {
  attributeRules,
  splitCssByChunkUsage,
  applyCssAutoSplit,
  CssSplitConservationError,
  type CssChunkEvidence,
} from '../css-auto-split.js';
import type { RouteModuleChain } from '../route-preload.js';
import { chunkCloser } from '../route-preload.js';

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
  it('scopes a rule whose classes are exclusive to one scopable chunk', async () => {
    const { owners } = await attributeRules(
      '.hx-hero{color:red}',
      CHUNKS,
      undefined
    );
    expect(owners).toEqual(['static/home-abc.js']);
  });

  it('keeps a rule global when its class appears in more than one chunk', async () => {
    const shared = [...CHUNKS, chunk('static/other-x.js', 'z("hx-hero")')];
    const { owners } = await attributeRules(
      '.hx-hero{color:red}',
      shared,
      undefined
    );
    expect(owners).toEqual([null]);
  });

  it('keeps zero-evidence classes global (never drops)', async () => {
    const { owners } = await attributeRules(
      '.runtime-only{color:red}',
      CHUNKS,
      undefined
    );
    expect(owners).toEqual([null]);
  });

  it('keeps classless selectors global (:root, elements, view transitions)', async () => {
    const css =
      ':root{--t:1}p{margin:0}::view-transition-group(x){animation:none}';
    const { owners } = await attributeRules(css, CHUNKS, undefined);
    expect(owners).toEqual([null, null, null]);
  });

  it('keeps rules owned by entry-closure (non-scopable) chunks global', async () => {
    const { owners } = await attributeRules(
      '.app-shell{color:red}',
      CHUNKS,
      undefined
    );
    expect(owners).toEqual([null]);
  });

  it('requires an anchor class outside functional pseudo-classes', async () => {
    // .hx-hero anchors; the :not() argument only adds evidence requirements.
    const scoped = await attributeRules(
      '.hx-hero:not(.hx-card){color:red}',
      CHUNKS,
      undefined
    );
    expect(scoped.owners).toEqual(['static/home-abc.js']);
    // div:not(.hx-hero) has no anchor: matching elements need not carry the class.
    const anchorless = await attributeRules(
      'div:not(.hx-hero){color:red}',
      CHUNKS,
      undefined
    );
    expect(anchorless.owners).toEqual([null]);
  });

  it('demotes when classes span two chunks, and when a selector list mixes routes', async () => {
    const span = await attributeRules(
      '.hx-hero .mdx-content{color:red}',
      CHUNKS,
      undefined
    );
    expect(span.owners).toEqual([null]);
    const list = await attributeRules(
      '.hx-hero,.mdx-content{color:red}',
      CHUNKS,
      undefined
    );
    expect(list.owners).toEqual([null]);
  });

  it('indexes only top-level style rules; nested rules follow their parent', async () => {
    const css = '.hx-hero{color:red;&:hover{color:blue}}';
    const { owners } = await attributeRules(css, CHUNKS, undefined);
    expect(owners).toEqual(['static/home-abc.js']);
  });

  it('collects top-level layer order from statements and blocks', async () => {
    const css =
      '@layer theme,base;@layer base{.hx-hero{color:red}}@layer utilities{.u{margin:0}}';
    const { layerNames } = await attributeRules(css, CHUNKS, undefined);
    expect(layerNames).toEqual(['theme', 'base', 'utilities']);
  });

  it('does not treat a @layer nested inside a @container/@scope/@starting-style as top-level', async () => {
    // atDepth must track the full CONTAINER_RULE_TYPES set (not just
    // media/supports/layer-block), or a @layer statement/block nested inside
    // a @container (or @scope/@starting-style) reads as atDepth === 0 and gets
    // wrongly collected into the top-level layer order, which the residual
    // then hoists into its layer-order prefix ahead of where the monolith
    // actually declared it.
    const css =
      '@container c (min-width:1px){@layer nested{.hx-hero{color:red}}}@layer a;';
    const { layerNames } = await attributeRules(css, CHUNKS, undefined);
    expect(layerNames).toEqual(['a']);
  });

  it('attributes rules inside @media by their classes', async () => {
    const css = '@media (min-width:600px){.hx-card{color:red}}';
    const { owners } = await attributeRules(css, CHUNKS, undefined);
    expect(owners).toEqual(['static/home-abc.js']);
  });
});

describe('splitCssByChunkUsage', () => {
  const opts = { minSize: 0 };

  it('moves scoped rules out of the residual and into per-chunk sheets', async () => {
    const css =
      '.hx-hero{color:red}.mdx-content{color:blue}.plain-shared{margin:0}';
    const result = await splitCssByChunkUsage(css, CHUNKS, opts);
    expect(result.perChunk.get('static/home-abc.js')).toContain('hx-hero');
    expect(result.perChunk.get('static/docs-def.js')).toContain('mdx-content');
    expect(result.residual).toContain('plain-shared');
    expect(result.residual).not.toContain('hx-hero');
    expect(result.residual).not.toContain('mdx-content');
  });

  it('reproduces @media wrappers around scoped rules', async () => {
    const css =
      '@media (min-width:600px){.hx-hero{color:red}.zz-none{color:blue}}';
    const result = await splitCssByChunkUsage(css, CHUNKS, opts);
    const home = result.perChunk.get('static/home-abc.js');
    expect(home).toMatch(/@media[^{]*\{[^{]*\.hx-hero/);
    expect(home).not.toContain('zz-none');
    expect(result.residual).toContain('zz-none');
  });

  it('keeps @keyframes, @font-face and custom-property rules in the residual', async () => {
    const css =
      '@keyframes spin{to{rotate:1turn}}@font-face{font-family:X;src:url(x.woff2)}.hx-hero{color:red}';
    const result = await splitCssByChunkUsage(css, CHUNKS, opts);
    expect(result.residual).toContain('@keyframes');
    expect(result.residual).toContain('@font-face');
    expect(result.residual).not.toContain('hx-hero');
  });

  it('re-declares the full top-level layer order at the head of the residual', async () => {
    const css =
      '@layer a,b,c;@layer b{.hx-hero{color:red}}@layer c{.plain-shared{margin:0}}';
    const result = await splitCssByChunkUsage(css, CHUNKS, opts);
    // Even with the whole @layer b block scoped away, the residual's first
    // declaration establishes a,b,c in monolith order.
    expect(result.residual.startsWith('@layer a,b,c;')).toBe(true);
    const home = result.perChunk.get('static/home-abc.js');
    expect(home).toContain('@layer b');
  });

  it('demotes chunks whose scoped CSS is below minSize back to the residual', async () => {
    const css = '.hx-hero{color:red}';
    const result = await splitCssByChunkUsage(css, CHUNKS, { minSize: 10_000 });
    expect(result.perChunk.size).toBe(0);
    expect(result.residual).toContain('hx-hero');
  });

  it('confines non-style at-rules to the residual, never per-chunk sheets', async () => {
    const css =
      '@keyframes spin{to{rotate:1turn}}@font-face{font-family:X;src:url(x.woff2)}.hx-hero{color:red}.mdx-content{color:blue}';
    const result = await splitCssByChunkUsage(css, CHUNKS, opts);
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

  it('reproduces @container wrappers and keeps owners indexing aligned', async () => {
    const css =
      '@container (min-width:400px){.hx-hero{color:red}}.mdx-content{color:blue}.plain-shared{margin:0}';
    const result = await splitCssByChunkUsage(css, CHUNKS, opts);
    const home = result.perChunk.get('static/home-abc.js');
    expect(home).toMatch(/@container[^{]*\{.*\.hx-hero/);
    expect(result.perChunk.get('static/docs-def.js')).toContain('mdx-content');
    expect(result.residual).toContain('plain-shared');
    expect(result.residual).not.toContain('hx-hero');
  });

  it('compares minSize against UTF-8 bytes, not UTF-16 code units', async () => {
    // The check marks are multi-byte in UTF-8 but one code unit each in
    // UTF-16, so byte length exceeds string length; a threshold between the
    // two keeps the sheet only if the splitter measures bytes.
    const css = '.hx-hero{--check:"✓✓✓✓"}';
    const probe = await splitCssByChunkUsage(css, CHUNKS, { minSize: 0 });
    const sheet = probe.perChunk.get('static/home-abc.js');
    expect(sheet).toBeDefined();
    if (sheet === undefined) return;
    const units = sheet.length;
    const bytes = Buffer.byteLength(sheet, 'utf8');
    expect(bytes).toBeGreaterThan(units);
    const kept = await splitCssByChunkUsage(css, CHUNKS, {
      minSize: units + 1,
    });
    expect(kept.perChunk.get('static/home-abc.js')).toBe(sheet);
    const demoted = await splitCssByChunkUsage(css, CHUNKS, {
      minSize: bytes + 1,
    });
    expect(demoted.perChunk.size).toBe(0);
    expect(demoted.residual).toContain('hx-hero');
  });

  it('keeps nested @layer statements in the residual', async () => {
    // Only TOP-LEVEL layer names are re-declared by the residual's prefix, so
    // a statement nested under a conditional at-rule must survive in place.
    const css = '@media (min-width:600px){@layer x;.plain-shared{margin:0}}';
    const result = await splitCssByChunkUsage(css, CHUNKS, opts);
    expect(result.residual).toContain('@layer x');
  });

  it('splits realistic theme CSS without corrupting serialization (visitor return-undefined regression)', async () => {
    // Regression pin for the Rule-visitor serialization bug: entry callbacks
    // that return the unmodified rule object (instead of `undefined`, "no
    // change") force Lightning CSS to re-serialize the rule from the
    // JS-visible AST, which corrupts declarations whose value contains a
    // `var()` reference (an "unparsed" value in Lightning CSS terms) and
    // throws "failed to deserialize; expected an object-like struct named
    // Specifier, found ()". The docs site's real Tailwind-v4 root.css hit it
    // on exactly this shape: a `@layer theme{:root,:host{...}}` block whose
    // trailing `--default-font-family:var(--font-sans)` carries the var()
    // (the font lists / oklch() / calc() around it are realistic dressing;
    // probing showed the var() reference is the load-bearing trigger). The
    // splitter's failure policy then silently degraded the WHOLE sheet to
    // unsplit (build stays green), so this test is the only red signal for
    // that bug class.
    const css = [
      '@layer theme{:root,:host{',
      '--font-sans:ui-sans-serif,system-ui,sans-serif;',
      '--font-mono:ui-monospace,SFMono-Regular,monospace;',
      '--color-red-500:oklch(63.7% .237 25.331);',
      '--color-zinc-900:oklch(21% .006 285.885);',
      '--text-sm:.875rem;',
      '--text-sm--line-height:calc(1.25 / .875);',
      '--ease-out:cubic-bezier(0,0,.2,1);',
      '--default-font-family:var(--font-sans);',
      '}}',
      '@font-face{font-family:Selawik;font-weight:400;',
      "src:url(selawik-regular.woff2) format('woff2');}",
      '.hx-hero{color:oklch(63.7% .237 25.331);font-family:var(--font-sans)}',
    ].join('');
    const result = await splitCssByChunkUsage(css, CHUNKS, opts);
    // The scopable class rule lands in its per-chunk sheet.
    expect(result.perChunk.get('static/home-abc.js')).toContain('hx-hero');
    expect(result.residual).not.toContain('hx-hero');
    // The custom-property block and font-face survive intact in the residual.
    expect(result.residual).toContain(
      '--font-sans:ui-sans-serif,system-ui,sans-serif'
    );
    expect(result.residual).toContain('--text-sm--line-height:calc(');
    expect(result.residual).toContain('--default-font-family:var(--font-sans)');
    expect(result.residual).toMatch(/--color-red-500:oklch\(/);
    expect(result.residual).toMatch(
      /@font-face\{[^}]*src:url\(selawik-regular\.woff2\)\s*format\("woff2"\)/
    );
  });

  it('conserves every rule exactly once across outputs', async () => {
    const css = [
      '@layer theme,base;',
      ':root{--t:1}',
      '.hx-hero{color:red}',
      '@media (min-width:600px){.hx-card{color:blue}.mdx-content{margin:0}}',
      '.plain-shared{padding:0}',
    ].join('');
    const result = await splitCssByChunkUsage(css, CHUNKS, opts);
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

// Splits an already-minified (single-line, comment-free) Lightning CSS output
// into its top-level rule strings: block rules end at their balanced closing
// `}`, statement rules (e.g. `@layer a,b;`) end at a top-level `;`. Depth and
// string-literal tracking keep braces/semicolons inside selectors, string
// values, or url()s from being mistaken for rule boundaries. Deliberately not
// a lightningcss visitor: the visitor API hands back AST nodes, not each
// node's own serialized text, so isolating one rule's text would mean one
// transform() call per rule; textual splitting of output both sides already
// ran through the SAME minifying transform() gets the same rule-level
// granularity for a fraction of the cost.
function splitTopLevelRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === '\\') {
        i++;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        rules.push(css.slice(start, i + 1));
        start = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      rules.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
  const rest = css.slice(start).trim();
  if (rest) rules.push(rest);
  return rules;
}

/** Canonical (minified, targets-normalized) top-level rule set, sorted for an order-insensitive comparison. */
function canonicalRuleSet(css: string): string[] {
  const minified = transform({
    filename: 'round-trip.css',
    code: Buffer.from(css),
    minify: true,
  }).code.toString();
  return splitTopLevelRules(minified).sort();
}

describe('splitCssByChunkUsage round-trip (spec section 8)', () => {
  it('the union of emitted sheets is rule-equivalent to the input monolith under real Lightning CSS serialization', async () => {
    // Representative fixture: a cascade layer with custom properties whose
    // values are var() references (the bisected trigger for the visitor
    // serialization bug this splitter had; see the "splits realistic theme
    // CSS" regression test above), a leaf at-rule (@font-face), a container
    // at-rule (@media) wrapping a scoped rule, and a residual-only rule.
    // Every rule here has a SINGLE owner (or none), so no at-rule wrapper is
    // split across multiple output sheets; the round-trip invariant holds
    // rule-for-rule rather than only up to wrapper repartitioning.
    const css = [
      '@layer theme{:root,:host{',
      '--font-sans:ui-sans-serif,system-ui,sans-serif;',
      '--color-red-500:oklch(63.7% .237 25.331);',
      '--text-sm--line-height:calc(1.25 / .875);',
      '--default-font-family:var(--font-sans);',
      '}}',
      '@font-face{font-family:Selawik;font-weight:400;',
      "src:url(selawik-regular.woff2) format('woff2');}",
      '.hx-hero{color:oklch(63.7% .237 25.331);font-family:var(--font-sans)}',
      '@media (min-width:600px){.hx-hero{padding:var(--text-sm--line-height)}}',
      '.plain-shared{margin:0}',
    ].join('');

    const result = await splitCssByChunkUsage(css, CHUNKS, { minSize: 0 });

    // The residual's layer-order prefix (`@layer <names>;`) is prepended as a
    // raw string ahead of the transformed residual code (see the layerPrefix
    // line in splitCssByChunkUsage), not a statement the input monolith ever
    // declared (the monolith declares the `theme` layer via the `@layer
    // theme{...}` BLOCK, not a bare statement). Strip it before comparison so
    // the round-trip check compares like for like; the layer-order guarantee
    // itself is covered separately by the "re-declares the full top-level
    // layer order" test above.
    const residualWithoutPrefix = result.residual.replace(/^@layer[^;]*;/, '');

    const reconstructed = [
      residualWithoutPrefix,
      ...result.perChunk.values(),
    ].join('');

    expect(canonicalRuleSet(reconstructed)).toEqual(canonicalRuleSet(css));
  });
});

function fixtureBundle() {
  // entry -> (static) shared vendor; /home lazy-imports home chunk.
  return {
    'static/client.js': {
      type: 'chunk' as const,
      fileName: 'static/client.js',
      isEntry: true,
      code: 'boot("app-shell")',
      moduleIds: ['/src/entry.ts'],
      imports: [],
      viteMetadata: { importedCss: new Set(['static/global-orig.css']) },
    },
    'static/home-abc.js': {
      type: 'chunk' as const,
      fileName: 'static/home-abc.js',
      isEntry: false,
      code: 'render("hx-hero")',
      moduleIds: ['/src/pages/home.tsx'],
      imports: [],
      viteMetadata: { importedCss: new Set<string>() },
    },
    'static/global-orig.css': {
      type: 'asset' as const,
      fileName: 'static/global-orig.css',
      source: '.hx-hero{color:red}.app-shell{margin:0}',
    },
  };
}

const HOME_CHAIN: RouteModuleChain[] = [
  { pattern: '/', sources: ['/src/pages/home.tsx'] },
];

function fakeEmitter() {
  const emitted = new Map<string, { name: string; source: string }>();
  let n = 0;
  return {
    emitted,
    emitFile: (a: { type: 'asset'; name: string; source: string }) => {
      const ref = `ref-${n++}`;
      emitted.set(ref, { name: a.name, source: a.source });
      return ref;
    },
    getFileName: (ref: string) =>
      `static/${emitted.get(ref)!.name.replace(/\.css$/, '')}-HASH.css`,
  };
}

describe('applyCssAutoSplit', () => {
  it('splits, rewires viteMetadata, deletes the original, returns residual urls', async () => {
    const bundle = fixtureBundle();
    const { emitFile, getFileName, emitted } = fakeEmitter();
    const globalCss = await applyCssAutoSplit(
      bundle,
      HOME_CHAIN,
      chunkCloser(bundle),
      {
        autoSplit: true,
        minSize: 0,
        emitFile,
        getFileName,
        warn: () => {},
      }
    );
    // Residual keeps the entry-evidence rule, loses the scoped one.
    const residual = [...emitted.values()].find((a) =>
      a.source.includes('app-shell')
    );
    expect(residual).toBeDefined();
    expect(residual!.source).not.toContain('hx-hero');
    expect(globalCss).toHaveLength(1);
    expect(globalCss[0]).toMatch(/^\/static\/.*-HASH\.css$/);
    // Scoped sheet attached to the home chunk's importedCss.
    const homeCss = [...bundle['static/home-abc.js'].viteMetadata.importedCss];
    expect(homeCss.some((f) => f.endsWith('-HASH.css'))).toBe(true);
    // Original gone from bundle and from the entry's importedCss.
    expect(
      (bundle as Record<string, unknown>)['static/global-orig.css']
    ).toBeUndefined();
    expect(
      bundle['static/client.js'].viteMetadata.importedCss.has(
        'static/global-orig.css'
      )
    ).toBe(false);
  });

  it('autoSplit=false delivers the monolith untouched via globalCss', async () => {
    const bundle = fixtureBundle();
    const { emitFile, getFileName } = fakeEmitter();
    const globalCss = await applyCssAutoSplit(
      bundle,
      HOME_CHAIN,
      chunkCloser(bundle),
      {
        autoSplit: false,
        minSize: 0,
        emitFile,
        getFileName,
        warn: () => {},
      }
    );
    expect(globalCss).toEqual(['/static/global-orig.css']);
    expect(
      (bundle as Record<string, unknown>)['static/global-orig.css']
    ).toBeDefined();
  });

  it('degrades to unsplit delivery (with a warning) when the CSS cannot be parsed', async () => {
    const bundle = fixtureBundle();
    // Lightning CSS error-recovers from malformed source instead of throwing,
    // so the degrade path is triggered by making the asset unreadable
    // (deleting it) rather than by feeding it invalid CSS.
    delete (bundle as Record<string, unknown>)['static/global-orig.css'];
    const warnings: string[] = [];
    const { emitFile, getFileName } = fakeEmitter();
    const globalCss = await applyCssAutoSplit(
      bundle,
      HOME_CHAIN,
      chunkCloser(bundle),
      {
        autoSplit: true,
        minSize: 0,
        emitFile,
        getFileName,
        warn: (m) => warnings.push(m),
      }
    );
    expect(globalCss).toEqual(['/static/global-orig.css']);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('propagates a conservation error and leaves the original asset in place', async () => {
    const bundle = fixtureBundle();
    const { emitFile, getFileName } = fakeEmitter();
    await expect(
      applyCssAutoSplit(bundle, HOME_CHAIN, chunkCloser(bundle), {
        autoSplit: true,
        minSize: 0,
        emitFile,
        getFileName,
        warn: () => {},
        split: () => {
          throw new CssSplitConservationError('deliberate mismatch');
        },
      })
    ).rejects.toThrow(CssSplitConservationError);
    // The failed asset was not deleted: nothing shipped a page missing its CSS.
    expect(
      (bundle as Record<string, unknown>)['static/global-orig.css']
    ).toBeDefined();
    expect(
      bundle['static/client.js'].viteMetadata.importedCss.has(
        'static/global-orig.css'
      )
    ).toBe(true);
  });

  it('degrades to unsplit delivery (with a warning) when the splitter throws a generic error', async () => {
    const bundle = fixtureBundle();
    const warnings: string[] = [];
    const { emitFile, getFileName } = fakeEmitter();
    const globalCss = await applyCssAutoSplit(
      bundle,
      HOME_CHAIN,
      chunkCloser(bundle),
      {
        autoSplit: true,
        minSize: 0,
        emitFile,
        getFileName,
        warn: (m) => warnings.push(m),
        split: () => {
          throw new Error('lightningcss exploded');
        },
      }
    );
    expect(globalCss).toEqual(['/static/global-orig.css']);
    expect(
      (bundle as Record<string, unknown>)['static/global-orig.css']
    ).toBeDefined();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('lightningcss exploded');
  });
});
