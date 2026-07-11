# CSS Auto-Split (Layer 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an app author one global stylesheet that the framework tree-shakes at build time into a residual global sheet plus per-chunk route sheets, delivered through the existing route-CSS machinery, with Lightning CSS as the framework's CSS engine (splitter, minifier, Baseline targets).

**Architecture:** A `generateBundle`-stage splitter in `packages/vite` (beside `route-preload.ts`) parses the client entry's CSS assets with Lightning CSS, attributes each top-level style rule to a single JS chunk by class-name evidence scanned across every chunk's code, emits per-chunk sheets as fresh hashed assets folded into the existing `routeCss` map, and records the residual in a new `globalCss` artifact field that `renderPage` injects as a render-blocking link. Spec: `docs/superpowers/specs/2026-07-09-css-auto-split-design.md`.

**Tech Stack:** TypeScript, Vite 8 (ships `lightningcss` as a regular dependency), lightningcss 1.32 `transform` + visitor API, vitest, pnpm monorepo.

## Global Constraints

- Work in an isolated git worktree on a new branch off `origin/main`; run `pnpm wt:setup` first (installs, builds `dist/`, typechecks). Serena is unavailable in worktrees; use rg/Read/Edit with worktree-prefixed absolute paths.
- Safety invariant (from the spec): a rule that cannot be proven route-exclusive stays global; no rule is ever dropped or duplicated. Conservation mismatch fails the build; a parse failure degrades to delivering the monolith unsplit (never drops CSS).
- Cascade contract: scoped rules behave exactly like Layer 1 hand-split sheets (load after global, win equal-specificity ties).
- No em-dashes in prose or comments. No inline type casts; reshape types instead (structural reads off parsed CSS AST data are an accepted boundary).
- TDD per task: failing test, run it, minimal code, green, commit. Run `pnpm typecheck` whenever shared types change (test:types alone does not cover it).
- Framework dist must be rebuilt (`pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`) before `pnpm typecheck` or site builds after cross-package changes.
- Before push: the 8 CI-parity steps in CLAUDE.md (build, gen:agents-corpus, format:check, typecheck, test:types, test:coverage, test:integration, site build).
- Verified probe facts this plan relies on (Vite 8.0.8 + lightningcss 1.32.0): a normal plugin's `generateBundle` sees the entry chunk's `viteMetadata.importedCss`, the CSS asset has a string `source`, `this.emitFile({type:'asset', name})` + `this.getFileName(ref)` yield hashed names, and deleting `bundle[fileName]` works. Visitor callbacks fire as `Rule.style` / `Rule.media` / `Rule['layer-block']` / `Rule['layer-statement']` / `Rule.keyframes` with `RuleExit` counterparts; style rule selectors are `rule.value.selectors: Array<Array<component>>` with components like `{type:'class', name:'home-x'}` and `{type:'pseudo-class', kind:'not', selectors:[[...]]}`; `:root` is `{type:'pseudo-class', kind:'root'}` (classless). Returning `[]` from a visitor removes the rule. Lightning CSS minify may rewrite `@layer a,b;` statements, so the splitter re-emits the collected layer order itself (Task 3).

---

### Task 1: Baseline targets constant + framework-owned CSS minifier

**Files:**
- Create: `packages/vite/src/css-targets.ts`
- Create: `packages/vite/src/__tests__/css-config.test.ts`
- Modify: `packages/vite/src/hono-preact.ts` (config plugin only; the `css` user option arrives in Task 5)
- Modify: `packages/vite/package.json` (add `lightningcss` dependency)

**Interfaces:**
- Produces: `BASELINE_TARGETS: Targets` (lightningcss-encoded browser versions) consumed by Task 3's serializer and by the Vite config.
- Produces: the `hono-preact:config` plugin's `config()` now returns `build.cssMinify: 'lightningcss'` and `css.lightningcss.targets: BASELINE_TARGETS` unless the user configured either.

- [ ] **Step 1: Add the dependency**

In `packages/vite/package.json` `dependencies`, after `"@hono-preact/iso": "workspace:*"`:

```json
    "lightningcss": "^1.32.0",
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/vite/src/__tests__/css-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Plugin, UserConfig } from 'vite';
import { honoPreact } from '../hono-preact.js';
import { BASELINE_TARGETS } from '../css-targets.js';
import type { HonoPreactAdapter } from '../adapter.js';

const stubAdapter: HonoPreactAdapter = {
  name: 'stub',
  vitePlugins: () => [],
  wrapEntry: () => '',
};

function configResult(userConfig: UserConfig): UserConfig {
  const plugins = honoPreact({ adapter: stubAdapter });
  const config = plugins.find((p): p is Plugin => p.name === 'hono-preact:config');
  if (!config || typeof config.config !== 'function') {
    throw new Error('hono-preact:config plugin with a config() fn expected');
  }
  const result = config.config.call(
    // Plugin context is unused by this hook.
    undefined as never,
    userConfig,
    { command: 'build', mode: 'production' }
  );
  if (!result || typeof result !== 'object') throw new Error('expected a partial config');
  return result as UserConfig;
}

describe('framework CSS pipeline defaults', () => {
  it('opts the build into lightningcss minification with Baseline targets', () => {
    const result = configResult({});
    expect(result.build?.cssMinify).toBe('lightningcss');
    expect(result.css?.lightningcss?.targets).toEqual(BASELINE_TARGETS);
  });

  it('respects a user-configured cssMinify', () => {
    const result = configResult({ build: { cssMinify: 'esbuild' } });
    expect(result.build?.cssMinify).toBeUndefined();
  });

  it('respects user-configured lightningcss options', () => {
    const result = configResult({ css: { lightningcss: { targets: { chrome: 100 << 16 } } } });
    expect(result.css).toBeUndefined();
  });

  it('encodes plausible Baseline Widely Available versions', () => {
    // Sanity floor: all majors >= the late-2023 releases.
    expect(BASELINE_TARGETS.chrome).toBeGreaterThanOrEqual(120 << 16);
    expect(BASELINE_TARGETS.safari).toBeGreaterThanOrEqual((17 << 16) | (2 << 8));
  });
});
```

Note: the `as never` for the plugin-hook `this` is a test-harness necessity (the hook ignores its context), not a production cast.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/css-config.test.ts`
Expected: FAIL (`css-targets.js` not found).

- [ ] **Step 4: Implement**

`packages/vite/src/css-targets.ts`:

```ts
// The framework's browser floor for CSS lowering, encoded for Lightning CSS
// (major << 16 | minor << 8). Policy: Baseline Widely Available (features
// interoperable across the core browsers for ~30 months). Floor as of this
// writing: the late-2023 releases. Revisit at each release; bumping only ever
// REMOVES lowering (newer floors need less transpilation), so a stale value is
// extra bytes, not breakage.
import type { Targets } from 'lightningcss';

const v = (major: number, minor = 0): number => (major << 16) | (minor << 8);

export const BASELINE_TARGETS: Targets = {
  chrome: v(120),
  edge: v(120),
  firefox: v(121),
  safari: v(17, 2),
  ios_saf: v(17, 2),
};
```

In `packages/vite/src/hono-preact.ts`, import `BASELINE_TARGETS` and change the config plugin's `config()` to consult the user config (the returned partial is merged OVER the user config by Vite, so the guard must be explicit):

```ts
    config(userConfig) {
      return {
        resolve: {
          dedupe: ['preact', 'preact/hooks', 'preact-iso'],
        },
        build: {
          target: 'esnext' as const,
          assetsDir: 'static',
          // Framework-owned CSS minification: the same Lightning CSS engine the
          // auto-splitter uses, so one parser/serializer owns all CSS semantics.
          // Only when the user has not chosen a minifier themselves.
          ...(userConfig.build?.cssMinify === undefined
            ? { cssMinify: 'lightningcss' as const }
            : {}),
        },
        // Baseline-derived lowering targets, unless the user configured their
        // own lightningcss options (theirs win wholesale to avoid partial merges).
        ...(userConfig.css?.lightningcss === undefined
          ? { css: { lightningcss: { targets: BASELINE_TARGETS } } }
          : {}),
        environments: {
          /* unchanged */
        },
      };
    },
```

Keep the existing `environments` block byte-identical.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/css-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`

```bash
git add packages/vite/package.json pnpm-lock.yaml packages/vite/src/css-targets.ts packages/vite/src/hono-preact.ts packages/vite/src/__tests__/css-config.test.ts
git commit -m "feat(vite): lightningcss minification with Baseline targets as the framework default"
```

---

### Task 2: Splitter attribution (selector analysis + rule ownership)

**Files:**
- Create: `packages/vite/src/css-auto-split.ts`
- Create: `packages/vite/src/__tests__/css-auto-split.test.ts`

**Interfaces:**
- Produces (consumed by Task 3 within the same module, and by tests):
  - `interface CssChunkEvidence { fileName: string; code: string; scopable: boolean }`
  - `analyzeSelectorList(selectors: SelectorListLike): { anchored: boolean; classes: string[] }` (exported for tests)
  - `attributeRules(cssCode: string, chunks: readonly CssChunkEvidence[], targets: Targets | undefined): { owners: Array<string | null>; layerNames: string[]; }` (exported for tests). `owners[i]` is the owning chunk fileName of the i-th top-level style rule, or `null` for global.

- [ ] **Step 1: Write the failing tests**

`packages/vite/src/__tests__/css-auto-split.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  attributeRules,
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
    const { owners } = attributeRules('.runtime-only{color:red}', CHUNKS, undefined);
    expect(owners).toEqual([null]);
  });

  it('keeps classless selectors global (:root, elements, view transitions)', () => {
    const css = ':root{--t:1}p{margin:0}::view-transition-group(x){animation:none}';
    const { owners } = attributeRules(css, CHUNKS, undefined);
    expect(owners).toEqual([null, null, null]);
  });

  it('keeps rules owned by entry-closure (non-scopable) chunks global', () => {
    const { owners } = attributeRules('.app-shell{color:red}', CHUNKS, undefined);
    expect(owners).toEqual([null]);
  });

  it('requires an anchor class outside functional pseudo-classes', () => {
    // .hx-hero anchors; the :not() argument only adds evidence requirements.
    const scoped = attributeRules('.hx-hero:not(.hx-card){color:red}', CHUNKS, undefined);
    expect(scoped.owners).toEqual(['static/home-abc.js']);
    // div:not(.hx-hero) has no anchor: matching elements need not carry the class.
    const anchorless = attributeRules('div:not(.hx-hero){color:red}', CHUNKS, undefined);
    expect(anchorless.owners).toEqual([null]);
  });

  it('demotes when classes span two chunks, and when a selector list mixes routes', () => {
    const span = attributeRules('.hx-hero .mdx-content{color:red}', CHUNKS, undefined);
    expect(span.owners).toEqual([null]);
    const list = attributeRules('.hx-hero,.mdx-content{color:red}', CHUNKS, undefined);
    expect(list.owners).toEqual([null]);
  });

  it('indexes only top-level style rules; nested rules follow their parent', () => {
    const css = '.hx-hero{color:red;&:hover{color:blue}}';
    const { owners } = attributeRules(css, CHUNKS, undefined);
    expect(owners).toEqual(['static/home-abc.js']);
  });

  it('collects top-level layer order from statements and blocks', () => {
    const css = '@layer theme,base;@layer base{.hx-hero{color:red}}@layer utilities{.u{margin:0}}';
    const { layerNames } = attributeRules(css, CHUNKS, undefined);
    expect(layerNames).toEqual(['theme', 'base', 'utilities']);
  });

  it('attributes rules inside @media by their classes', () => {
    const css = '@media (min-width:600px){.hx-card{color:red}}';
    const { owners } = attributeRules(css, CHUNKS, undefined);
    expect(owners).toEqual(['static/home-abc.js']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/css-auto-split.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/vite/src/css-auto-split.ts` (attribution half; Task 3 appends the emission half to this same file):

```ts
// Build-time CSS auto-split (issue #249 Layer 3): tree-shake the app's global
// stylesheet into per-chunk sheets by class-name usage evidence. See
// docs/superpowers/specs/2026-07-09-css-auto-split-design.md.
//
// Safety invariant: a rule that cannot be PROVEN exclusive to one scopable
// chunk stays in the residual global sheet. Splitting is an optimization,
// never a correctness risk; nothing is ever dropped ("unused" CSS is not
// purged, it stays global).

import { transform } from 'lightningcss';
import type { Targets } from 'lightningcss';

/** One JS chunk's usage evidence for class scanning. */
export interface CssChunkEvidence {
  fileName: string;
  code: string;
  /**
   * Whether the chunk may OWN scoped CSS: it appears in some route chain and
   * is not part of the entry closure. Non-scopable chunks still count as
   * evidence (a class they contain is not exclusive elsewhere), but CSS scoped
   * to them would never be delivered (synthesized sheets ride the route-chain
   * maps only), so their rules stay global.
   */
  scopable: boolean;
}

// The structural subset of Lightning CSS's selector AST this module reads.
// Components are e.g. {type:'class', name} or {type:'pseudo-class', kind,
// selectors} for functional pseudo-classes (:is/:not/:where/:has).
interface SelectorComponentLike {
  type: string;
  name?: string;
  selectors?: SelectorComponentLike[][];
}
export type SelectorListLike = SelectorComponentLike[][];

/**
 * Walk one selector list. `anchored` is true when EVERY selector in the list
 * has at least one class outside functional pseudo-class arguments (an element
 * matching it must carry that class); `classes` is every class name mentioned
 * anywhere, including inside :is()/:not()/etc (all must pass the exclusivity
 * check, the conservative direction).
 */
export function analyzeSelectorList(selectors: SelectorListLike): {
  anchored: boolean;
  classes: string[];
} {
  const classes = new Set<string>();
  let anchored = true;
  for (const selector of selectors) {
    let anchor = false;
    for (const component of selector) {
      if (component.type === 'class' && component.name != null) {
        anchor = true;
        classes.add(component.name);
      } else if (component.selectors) {
        for (const nested of component.selectors) {
          collectNestedClasses(nested, classes);
        }
      }
    }
    if (!anchor) anchored = false;
  }
  return { anchored, classes: [...classes] };
}

function collectNestedClasses(
  selector: SelectorComponentLike[],
  out: Set<string>
): void {
  for (const component of selector) {
    if (component.type === 'class' && component.name != null) {
      out.add(component.name);
    } else if (component.selectors) {
      for (const nested of component.selectors) collectNestedClasses(nested, out);
    }
  }
}

/** Decide which chunk (if any) exclusively owns every class of a rule. */
function decideOwner(
  selectors: SelectorListLike,
  chunks: readonly CssChunkEvidence[]
): string | null {
  const { anchored, classes } = analyzeSelectorList(selectors);
  if (!anchored || classes.length === 0) return null;
  let owner: CssChunkEvidence | undefined;
  for (const cls of classes) {
    // Plain substring scan: catches JSX literals, clsx args, and classes inside
    // embedded HTML strings. False positives only WIDEN apparent usage, which
    // demotes toward global (the safe direction).
    const containing = chunks.filter((c) => c.code.includes(cls));
    if (containing.length !== 1) return null;
    const found = containing[0];
    if (!found.scopable) return null;
    if (owner && owner !== found) return null;
    owner = found;
  }
  return owner ? owner.fileName : null;
}

/**
 * Attribution pass: one Lightning CSS traversal assigning each TOP-LEVEL style
 * rule an owner (`null` = residual global). Nested style rules (CSS nesting)
 * follow their parent, so they get no index of their own. Also collects the
 * top-level cascade-layer order (statements and blocks, first-seen), which the
 * residual re-declares so scoping a whole @layer block cannot reorder layers.
 */
export function attributeRules(
  cssCode: string,
  chunks: readonly CssChunkEvidence[],
  targets: Targets | undefined
): { owners: Array<string | null>; layerNames: string[] } {
  const owners: Array<string | null> = [];
  const layerNames: string[] = [];
  const seenLayers = new Set<string>();
  const pushLayer = (name: string): void => {
    if (seenLayers.has(name)) return;
    seenLayers.add(name);
    layerNames.push(name);
  };
  let styleDepth = 0;
  let atDepth = 0;
  transform({
    filename: 'global.css',
    code: Buffer.from(cssCode),
    minify: false,
    targets,
    visitor: {
      Rule: {
        style(rule) {
          if (styleDepth === 0) {
            owners.push(decideOwner(rule.value.selectors, chunks));
          }
          styleDepth++;
          return rule;
        },
        media(rule) {
          atDepth++;
          return rule;
        },
        supports(rule) {
          atDepth++;
          return rule;
        },
        'layer-block'(rule) {
          if (atDepth === 0 && rule.value.name) pushLayer(rule.value.name.join('.'));
          atDepth++;
          return rule;
        },
        'layer-statement'(rule) {
          if (atDepth === 0) {
            for (const name of rule.value.names) pushLayer(name.join('.'));
          }
          return rule;
        },
      },
      RuleExit: {
        style(rule) {
          styleDepth--;
          return rule;
        },
        media(rule) {
          atDepth--;
          return rule;
        },
        supports(rule) {
          atDepth--;
          return rule;
        },
        'layer-block'(rule) {
          atDepth--;
          return rule;
        },
      },
    },
  });
  return { owners, layerNames };
}
```

Implementation notes for this step:
- If the `layer-statement` value shape differs from `rule.value.names` (verify against the installed `lightningcss` TS types in `node_modules`), adapt to the real property; the layer-order test pins the behavior either way.
- If TS complains about the visitor's selector types vs `SelectorListLike`, accept the structural read via a narrowing helper, not an `as` cast on the whole value.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/css-auto-split.test.ts`
Expected: PASS (all attribution cases).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/css-auto-split.ts packages/vite/src/__tests__/css-auto-split.test.ts
git commit -m "feat(vite): css auto-split attribution (class evidence -> chunk owners)"
```

---

### Task 3: Splitter emission (per-chunk sheets, residual, minSize, conservation)

**Files:**
- Modify: `packages/vite/src/css-auto-split.ts`
- Modify: `packages/vite/src/__tests__/css-auto-split.test.ts`

**Interfaces:**
- Produces (consumed by Task 4):
  - `interface CssSplitOptions { minSize: number; targets?: Targets }`
  - `interface CssSplitResult { residual: string; perChunk: Map<string, string> }`
  - `splitCssByChunkUsage(cssCode: string, chunks: readonly CssChunkEvidence[], opts: CssSplitOptions): CssSplitResult` (throws `Error` on a conservation mismatch)

- [ ] **Step 1: Write the failing tests** (append to `css-auto-split.test.ts`)

```ts
import { splitCssByChunkUsage } from '../css-auto-split.js';

describe('splitCssByChunkUsage', () => {
  const opts = { minSize: 0 };

  it('moves scoped rules out of the residual and into per-chunk sheets', () => {
    const css = '.hx-hero{color:red}.mdx-content{color:blue}.plain-shared{margin:0}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    expect(result.perChunk.get('static/home-abc.js')).toContain('hx-hero');
    expect(result.perChunk.get('static/docs-def.js')).toContain('mdx-content');
    expect(result.residual).toContain('plain-shared');
    expect(result.residual).not.toContain('hx-hero');
    expect(result.residual).not.toContain('mdx-content');
  });

  it('reproduces @media wrappers around scoped rules', () => {
    const css = '@media (min-width:600px){.hx-hero{color:red}.zz-none{color:blue}}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    const home = result.perChunk.get('static/home-abc.js');
    expect(home).toMatch(/@media[^{]*\{[^{]*\.hx-hero/);
    expect(home).not.toContain('zz-none');
    expect(result.residual).toContain('zz-none');
  });

  it('keeps @keyframes, @font-face and custom-property rules in the residual', () => {
    const css = '@keyframes spin{to{rotate:1turn}}@font-face{font-family:X;src:url(x.woff2)}.hx-hero{color:red}';
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    expect(result.residual).toContain('@keyframes');
    expect(result.residual).toContain('@font-face');
    expect(result.residual).not.toContain('hx-hero');
  });

  it('re-declares the full top-level layer order at the head of the residual', () => {
    const css = '@layer a,b,c;@layer b{.hx-hero{color:red}}@layer c{.plain-shared{margin:0}}';
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

  it('conserves every rule exactly once across outputs', () => {
    const css = [
      '@layer theme,base;',
      ':root{--t:1}',
      '.hx-hero{color:red}',
      '@media (min-width:600px){.hx-card{color:blue}.mdx-content{margin:0}}',
      '.plain-shared{padding:0}',
    ].join('');
    const result = splitCssByChunkUsage(css, CHUNKS, opts);
    const everything = [result.residual, ...result.perChunk.values()].join('\n');
    for (const marker of ['--t:1', 'hx-hero', 'hx-card', 'mdx-content', 'plain-shared']) {
      const count = everything.split(marker).length - 1;
      expect(count, marker).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/css-auto-split.test.ts`
Expected: FAIL (`splitCssByChunkUsage` not exported).

- [ ] **Step 3: Implement** (append to `css-auto-split.ts`)

```ts
export interface CssSplitOptions {
  /** Minimum emitted-sheet byte size; smaller scoped sets stay global. */
  minSize: number;
  targets?: Targets;
}

export interface CssSplitResult {
  /** Residual global CSS (minified; layer order re-declared at its head). */
  residual: string;
  /** Owning chunk fileName -> that chunk's scoped CSS (minified). */
  perChunk: Map<string, string>;
}

interface EmitResult {
  code: string;
  visited: number;
  kept: number;
}

/**
 * Emission pass: re-serialize the monolith keeping only the top-level style
 * rules `keep` accepts. Drops happen at RuleExit (enter/exit pairing is
 * guaranteed when enter never replaces), so nested traversal and index order
 * stay identical to the attribution pass. At-rule wrappers survive around kept
 * rules; emptied wrappers are pruned by minification. Layer statements are
 * stripped everywhere (the residual re-declares the canonical order itself).
 */
function emitSubset(
  cssCode: string,
  owners: ReadonlyArray<string | null>,
  keep: (owner: string | null) => boolean,
  targets: Targets | undefined
): EmitResult {
  let styleDepth = 0;
  let index = 0;
  let visited = 0;
  let kept = 0;
  const dropStack: boolean[] = [];
  const result = transform({
    filename: 'global.css',
    code: Buffer.from(cssCode),
    minify: true,
    targets,
    visitor: {
      Rule: {
        style(rule) {
          let drop = false;
          if (styleDepth === 0) {
            visited++;
            const owner = owners[index];
            index++;
            drop = !keep(owner ?? null);
            if (!drop) kept++;
          }
          dropStack.push(drop);
          styleDepth++;
          return rule;
        },
        'layer-statement'() {
          return [];
        },
      },
      RuleExit: {
        style(rule) {
          styleDepth--;
          const drop = dropStack.pop();
          if (drop) return [];
          return rule;
        },
      },
    },
  });
  return { code: result.code.toString(), visited, kept };
}

function assertConservation(
  label: string,
  visited: number,
  total: number
): void {
  if (visited !== total) {
    throw new Error(
      `[hono-preact] css auto-split conservation check failed for ${label}: ` +
        `visited ${visited} top-level style rules, expected ${total}. ` +
        `No split output was trusted; this is a splitter bug, please report it.`
    );
  }
}

/**
 * Split one global stylesheet into a residual plus per-chunk scoped sheets.
 * Throws on a conservation mismatch (a rule dropped or double-counted would
 * otherwise ship a broken page); callers turn that into a build failure.
 */
export function splitCssByChunkUsage(
  cssCode: string,
  chunks: readonly CssChunkEvidence[],
  opts: CssSplitOptions
): CssSplitResult {
  const { owners, layerNames } = attributeRules(cssCode, chunks, opts.targets);
  const total = owners.length;

  const owningChunks = [...new Set(owners.filter((o): o is string => o !== null))];
  const demoted = new Set<string>();
  const perChunk = new Map<string, string>();
  let scopedKept = 0;
  for (const owner of owningChunks) {
    const out = emitSubset(cssCode, owners, (o) => o === owner, opts.targets);
    assertConservation(owner, out.visited, total);
    if (out.code.length < opts.minSize) {
      demoted.add(owner);
      continue;
    }
    scopedKept += out.kept;
    perChunk.set(owner, out.code);
  }

  const residualOut = emitSubset(
    cssCode,
    owners,
    (o) => o === null || demoted.has(o),
    opts.targets
  );
  assertConservation('residual', residualOut.visited, total);
  if (residualOut.kept + scopedKept !== total) {
    throw new Error(
      `[hono-preact] css auto-split conservation check failed: ` +
        `${residualOut.kept} residual + ${scopedKept} scoped rules != ${total} input rules.`
    );
  }

  // Re-declare the monolith's top-level layer order first, so scoping an
  // entire @layer block into a route sheet cannot reorder cascade layers
  // (layer order is fixed by first declaration; later re-declarations are
  // no-ops, so this is also safe when the residual kept some blocks).
  const layerPrefix =
    layerNames.length > 0 ? `@layer ${layerNames.join(',')};` : '';
  return { residual: layerPrefix + residualOut.code, perChunk };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/css-auto-split.test.ts`
Expected: PASS. If the empty-`@media` pruning expectation fails (Lightning CSS keeping an empty wrapper), that is bytes-only, not correctness; adjust the assertion to tolerate an empty wrapper and note it in the module comment.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/css-auto-split.ts packages/vite/src/__tests__/css-auto-split.test.ts
git commit -m "feat(vite): css auto-split emission with layer-order preservation and conservation check"
```

---

### Task 4: Bundle integration + `globalCss` artifact field

**Files:**
- Modify: `packages/vite/src/css-auto-split.ts` (add `applyCssAutoSplit`)
- Modify: `packages/vite/src/route-preload.ts` (export `entryClosure`)
- Modify: `packages/vite/src/preload-manifest.ts`
- Modify: `packages/vite/src/__tests__/css-auto-split.test.ts`
- Modify: `packages/vite/src/__tests__/preload-manifest.test.ts`

**Interfaces:**
- Consumes: `splitCssByChunkUsage` (Task 3), `RouteModuleChain` / `chunkCloser` / `entryClosure` from `route-preload.ts`.
- Produces:
  - `PreloadArtifact` gains `globalCss: string[]` (always present; `[]` when the feature is off).
  - `PreloadManifestPluginOptions` gains `css?: { autoSplit: boolean; minSize: number }` (presence of the object = `css.global` configured; the plugin does not need the path itself, only whether the entry CSS is framework-owned).
  - `applyCssAutoSplit(bundle, chains, chunksOf, opts): string[]` where `opts = { autoSplit: boolean; minSize: number; targets?: Targets; emitFile: (a: {type:'asset'; name: string; source: string}) => string; getFileName: (ref: string) => string; warn: (msg: string) => void }`. Returns the residual/global sheet URLs. Mutates the bundle: emits per-chunk assets, appends them to owner chunks' `viteMetadata.importedCss`, deletes the original entry CSS assets, and removes them from the entry chunk's `importedCss`.

- [ ] **Step 1: Write the failing tests** (append to `css-auto-split.test.ts`)

```ts
import { applyCssAutoSplit } from '../css-auto-split.js';
import type { RouteModuleChain } from '../route-preload.js';
import { chunkCloser } from '../route-preload.js';

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
    getFileName: (ref: string) => `static/${emitted.get(ref)!.name.replace(/\.css$/, '')}-HASH.css`,
  };
}

describe('applyCssAutoSplit', () => {
  it('splits, rewires viteMetadata, deletes the original, returns residual urls', () => {
    const bundle = fixtureBundle();
    const { emitFile, getFileName, emitted } = fakeEmitter();
    const globalCss = applyCssAutoSplit(bundle, HOME_CHAIN, chunkCloser(bundle), {
      autoSplit: true, minSize: 0, emitFile, getFileName, warn: () => {},
    });
    // Residual keeps the entry-evidence rule, loses the scoped one.
    const residual = [...emitted.values()].find((a) => a.source.includes('app-shell'));
    expect(residual).toBeDefined();
    expect(residual!.source).not.toContain('hx-hero');
    expect(globalCss).toHaveLength(1);
    expect(globalCss[0]).toMatch(/^\/static\/.*-HASH\.css$/);
    // Scoped sheet attached to the home chunk's importedCss.
    const homeCss = [...bundle['static/home-abc.js'].viteMetadata.importedCss];
    expect(homeCss.some((f) => f.endsWith('-HASH.css'))).toBe(true);
    // Original gone from bundle and from the entry's importedCss.
    expect((bundle as Record<string, unknown>)['static/global-orig.css']).toBeUndefined();
    expect(bundle['static/client.js'].viteMetadata.importedCss.has('static/global-orig.css')).toBe(false);
  });

  it('autoSplit=false delivers the monolith untouched via globalCss', () => {
    const bundle = fixtureBundle();
    const { emitFile, getFileName } = fakeEmitter();
    const globalCss = applyCssAutoSplit(bundle, HOME_CHAIN, chunkCloser(bundle), {
      autoSplit: false, minSize: 0, emitFile, getFileName, warn: () => {},
    });
    expect(globalCss).toEqual(['/static/global-orig.css']);
    expect((bundle as Record<string, unknown>)['static/global-orig.css']).toBeDefined();
  });

  it('degrades to unsplit delivery (with a warning) when the CSS cannot be parsed', () => {
    const bundle = fixtureBundle();
    bundle['static/global-orig.css'].source = '.broken { color: ';
    const warnings: string[] = [];
    const { emitFile, getFileName } = fakeEmitter();
    const globalCss = applyCssAutoSplit(bundle, HOME_CHAIN, chunkCloser(bundle), {
      autoSplit: true, minSize: 0, emitFile, getFileName, warn: (m) => warnings.push(m),
    });
    expect(globalCss).toEqual(['/static/global-orig.css']);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
```

Note: Lightning CSS may recover from that malformed input instead of throwing; if the parse-degrade test cannot be triggered with invalid CSS, trigger the degrade path with a non-string source (`source: new Uint8Array(...)` is fine, so instead delete the asset entry to simulate a missing asset) and keep the assertion "degrades with a warning, never drops delivery".

In `preload-manifest.test.ts`, extend the existing artifact assertions: the emitted artifact JSON now always includes `"globalCss":[]` when the plugin is constructed without `css` options (find the existing `generateBundle`-level test and add the field to its expected artifact).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/css-auto-split.test.ts src/__tests__/preload-manifest.test.ts`
Expected: FAIL (`applyCssAutoSplit` not exported; artifact lacks `globalCss`).

- [ ] **Step 3: Implement**

In `route-preload.ts`, change `function entryClosure(` to `export function entryClosure(` (JSDoc stays).

Append to `css-auto-split.ts`:

```ts
import { entryClosure } from './route-preload.js';
import type { RouteBundleChunkLike, RouteModuleChain } from './route-preload.js';

/** Bundle entries as this module reads them: chunks carry code, assets a source. */
export interface SplitBundleEntryLike extends RouteBundleChunkLike {
  code?: string;
  source?: string | Uint8Array;
}

export interface CssAutoSplitBundleOptions {
  autoSplit: boolean;
  minSize: number;
  targets?: Targets;
  emitFile: (asset: { type: 'asset'; name: string; source: string }) => string;
  getFileName: (ref: string) => string;
  warn: (msg: string) => void;
}

function assetSource(entry: SplitBundleEntryLike): string | undefined {
  if (typeof entry.source === 'string') return entry.source;
  if (entry.source instanceof Uint8Array) return new TextDecoder().decode(entry.source);
  return undefined;
}

/**
 * Split every CSS asset the client entry chunk imports (the framework-owned
 * global stylesheet, plus anything else entry-imported) against the bundle's
 * usage evidence, wiring per-chunk sheets into `viteMetadata.importedCss` so
 * the existing `resolveRouteCssMap` union delivers them per route. Returns the
 * residual sheet URLs for the artifact's `globalCss`.
 *
 * Failure policy per the spec: a conservation mismatch THROWS (the caller
 * fails the build; a dropped rule is a broken page). Any other per-asset
 * failure warns and degrades to delivering that asset unsplit.
 */
export function applyCssAutoSplit(
  bundle: Record<string, SplitBundleEntryLike>,
  chains: readonly RouteModuleChain[],
  chunksOf: (src: string) => ReadonlySet<string>,
  opts: CssAutoSplitBundleOptions
): string[] {
  const entry = Object.values(bundle).find(
    (c) => c.isEntry && c.type !== 'asset'
  );
  const entryCssFiles = [...(entry?.viteMetadata?.importedCss ?? [])];
  if (entryCssFiles.length === 0) return [];

  if (!opts.autoSplit) return entryCssFiles.map((f) => '/' + f);

  const eager = entryClosure(bundle);
  const scopable = new Set<string>();
  for (const chain of chains) {
    for (const src of chain.sources) {
      for (const file of chunksOf(src)) {
        if (!eager.has(file)) scopable.add(file);
      }
    }
  }
  const evidence: CssChunkEvidence[] = [];
  for (const c of Object.values(bundle)) {
    if (c.type === 'asset' || typeof c.code !== 'string') continue;
    evidence.push({
      fileName: c.fileName,
      code: c.code,
      scopable: scopable.has(c.fileName),
    });
  }

  const globalCss: string[] = [];
  for (const cssFile of entryCssFiles) {
    const asset = bundle[cssFile];
    const source = asset ? assetSource(asset) : undefined;
    if (source === undefined) {
      opts.warn(`css auto-split: entry stylesheet ${cssFile} unreadable; delivering it unsplit`);
      globalCss.push('/' + cssFile);
      continue;
    }
    let split: CssSplitResult;
    try {
      split = splitCssByChunkUsage(source, evidence, {
        minSize: opts.minSize,
        targets: opts.targets,
      });
    } catch (e) {
      // Conservation failures must fail the build (spec); rethrow for the
      // plugin to turn into this.error. Anything else degrades to unsplit.
      if (e instanceof Error && e.message.includes('conservation')) throw e;
      opts.warn(
        `css auto-split: could not split ${cssFile} (${e instanceof Error ? e.message : String(e)}); delivering it unsplit`
      );
      globalCss.push('/' + cssFile);
      continue;
    }

    for (const [ownerFile, css] of split.perChunk) {
      const base = ownerFile.replace(/^.*\//, '').replace(/\.js$/, '');
      const ref = opts.emitFile({ type: 'asset', name: `${base}.scoped.css`, source: css });
      const emittedFile = opts.getFileName(ref);
      const owner = bundle[ownerFile];
      if (!owner) continue;
      owner.viteMetadata ??= { importedCss: new Set<string>() };
      owner.viteMetadata.importedCss ??= new Set<string>();
      owner.viteMetadata.importedCss.add(emittedFile);
    }

    const residualRef = opts.emitFile({
      type: 'asset',
      name: 'global.css',
      source: split.residual,
    });
    globalCss.push('/' + opts.getFileName(residualRef));
    delete bundle[cssFile];
    entry?.viteMetadata?.importedCss?.delete(cssFile);
  }
  return globalCss;
}
```

In `preload-manifest.ts`:
- `PreloadArtifact` gains `globalCss: string[];` (JSDoc: "the residual global stylesheet URLs the SSR head injects render-blocking before route sheets; `[]` unless the app configured `css.global`").
- `PreloadManifestPluginOptions` gains:

```ts
  /** Present when the app configured `css.global` (framework-owned global CSS). */
  css?: { autoSplit: boolean; minSize: number };
```

- The plugin stores resolved lightningcss targets in `configResolved`:

```ts
    let targets: Targets | undefined;
    // inside configResolved(config), after routesAbsPath:
    targets = config.css?.lightningcss?.targets;
```

(import `type { Targets } from 'lightningcss'`.)

- Rework `generateBundle` so chains resolve once and the split runs between chain extraction and map resolution:

```ts
    generateBundle(_options, bundle) {
      if (this.environment?.name !== 'client') return;
      const warn = (msg: string): void => this.warn(`[preload] ${msg}`);
      const closure = collectEntryPreloadModules(bundle);
      const chains = readRouteChains(routesAbsPath, warn);
      const chunksOf = chunkCloser(bundle);
      let globalCss: string[] = [];
      if (opts.css) {
        try {
          globalCss = applyCssAutoSplit(bundle, chains, chunksOf, {
            autoSplit: opts.css.autoSplit,
            minSize: opts.css.minSize,
            targets,
            emitFile: (a) => this.emitFile(a),
            getFileName: (ref) => this.getFileName(ref),
            warn,
          });
        } catch (e) {
          this.error(
            `[hono-preact] css auto-split failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
      const routes = resolvePreloadMap(chains, bundle, chunksOf);
      const routeCss = resolveRouteCssMap(chains, bundle, chunksOf);
      const artifact: PreloadArtifact = { closure, routes, routeCss, globalCss };
      this.emitFile({
        type: 'asset',
        fileName: PRELOAD_MANIFEST_FILE,
        source: JSON.stringify(artifact),
      });
    },
```

where `readRouteChains` replaces `buildRouteMaps`' front half (same best-effort read/extract with try/catch returning `[]`); keep its degrade-never-fail JSDoc. `applyCssAutoSplit` needs the bundle typed as `Record<string, SplitBundleEntryLike>`; Rollup's `OutputBundle` chunks/assets satisfy it structurally (chunks have `code: string`, assets have `source`), so accept the hook's bundle through a parameter typed to the structural interface, not a cast.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/css-auto-split.test.ts src/__tests__/preload-manifest.test.ts src/__tests__/route-css.test.ts`
Expected: PASS (including pre-existing route-css tests, untouched behavior).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`

```bash
git add packages/vite/src/css-auto-split.ts packages/vite/src/route-preload.ts packages/vite/src/preload-manifest.ts packages/vite/src/__tests__/
git commit -m "feat(vite): wire css auto-split into the client bundle and preload artifact (globalCss)"
```

---

### Task 5: `css` user option + client-entry import (build only)

**Files:**
- Modify: `packages/vite/src/hono-preact.ts`
- Modify: `packages/vite/src/client-entry.ts`
- Create: `packages/vite/src/__tests__/client-entry-css.test.ts`

**Interfaces:**
- Produces: `HonoPreactOptions.css?: { global?: string; autoSplit?: boolean; minSize?: number }` (defaults: autoSplit `true`, minSize `1024`).
- Produces: `GenerateClientEntrySourceOptions.cssGlobalAbsPath?: string`; when set, the generated entry starts with `import '<abs css path>';`.
- Consumes: Task 4's `PreloadManifestPluginOptions.css`.
- Produces for Task 8: `serverEntryPlugin` receives `cssGlobal` (threaded now, used there).

- [ ] **Step 1: Write the failing test**

`packages/vite/src/__tests__/client-entry-css.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateClientEntrySource } from '../client-entry.js';

describe('client entry global CSS import', () => {
  it('imports the global stylesheet first when configured', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
      cssGlobalAbsPath: '/proj/src/styles/root.css',
    });
    expect(src.startsWith(`import '/proj/src/styles/root.css';`)).toBe(true);
  });

  it('emits no CSS import when not configured', () => {
    const src = generateClientEntrySource({ routesAbsPath: '/proj/src/routes.ts' });
    expect(src).not.toContain('.css');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/client-entry-css.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`client-entry.ts`:

```ts
export interface GenerateClientEntrySourceOptions {
  routesAbsPath: string;
  /**
   * Absolute path of the app's framework-owned global stylesheet
   * (`honoPreact({ css: { global } })`). Imported first so Vite's CSS pipeline
   * processes it into the entry chunk's importedCss, where the auto-splitter
   * picks it up. Build-time only: in dev the import would apply styles via JS
   * after hydration (a global FOUC), so the dev server instead injects a
   * <link> to the source URL (see the dev-global-css seam in the server pkg).
   */
  cssGlobalAbsPath?: string;
}
```

and prepend in `generateClientEntrySource`:

```ts
  return (
    (opts.cssGlobalAbsPath ? `import '${opts.cssGlobalAbsPath}';\n` : '') +
    `import { h, hydrate } from 'preact';\n` +
    // ... rest unchanged
```

`ClientEntryPluginOptions` gains `cssGlobal?: string` (project-relative or absolute). In the plugin, resolve it beside `routesAbsPath` in `configResolved` and record `isBuild = config.command === 'build'`; in `load`, pass `cssGlobalAbsPath` only when `isBuild` and the option is set.

`hono-preact.ts`:

```ts
export interface HonoPreactCssOptions {
  /**
   * Project-relative (or absolute) path to the app's global stylesheet. When
   * set, the framework owns its delivery: it is bundled through the client
   * build and injected into the SSR head (dev and prod), so the app must NOT
   * also link it manually. Enables the build-time auto-split by default.
   */
  global?: string;
  /** Default true (when `global` is set). Set false to deliver it unsplit. */
  autoSplit?: boolean;
  /** Minimum per-chunk scoped sheet size in bytes; smaller stays global. Default 1024. */
  minSize?: number;
}
```

Add `css?: HonoPreactCssOptions` to `HonoPreactOptions`, destructure `css` with the others, and in `honoPreact()`:

```ts
  const cssGlobal = css?.global;
  if (cssGlobal !== undefined) {
    const abs = resolve(process.cwd(), cssGlobal);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `[hono-preact] css.global points at '${cssGlobal}', which does not exist. ` +
          `Pass a project-relative path to your global stylesheet, e.g. 'src/styles/root.css'.`
      );
    }
  }
```

(import `* as fs from 'node:fs'`; note `process.cwd()` matches the existing `ctx.root` convention in this file). Thread the option:

```ts
    clientEntryPlugin({ routes, cssGlobal }),
    preloadManifestPlugin({
      routes,
      css: cssGlobal
        ? { autoSplit: css?.autoSplit ?? true, minSize: css?.minSize ?? 1024 }
        : undefined,
    }),
    serverEntryPlugin({ /* existing options */ , cssGlobal }),
```

(`serverEntryPlugin` accepts and ignores `cssGlobal` until Task 8; add the optional field to `ServerEntryPluginOptions` now so the thread compiles: `cssGlobal?: string`.)

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @hono-preact/vite exec vitest run && pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/hono-preact.ts packages/vite/src/client-entry.ts packages/vite/src/server-entry.ts packages/vite/src/__tests__/client-entry-css.test.ts
git commit -m "feat(vite): css.global option, client-entry stylesheet import (build only)"
```

---

### Task 6: Server manifest `globalCss` + dev-global-css seam

**Files:**
- Modify: `packages/server/src/preload-modules.ts`
- Create: `packages/server/src/dev-global-css.ts`
- Modify: `packages/server/src/internal-runtime.ts`
- Modify: `packages/server/src/__tests__/preload-modules.test.ts`

**Interfaces:**
- Produces: `PreloadManifest.globalCss: string[]` (normalized; `[]` default).
- Produces: `installDevGlobalCss(urls: readonly string[]): void`, `getDevGlobalCss(): readonly string[] | undefined`, `__resetDevGlobalCssForTests(): void` from `dev-global-css.ts`; `installDevGlobalCss` re-exported from `internal-runtime.ts` (codegen contract for Task 8).

- [ ] **Step 1: Write the failing tests** (append to `preload-modules.test.ts`)

```ts
import {
  installDevGlobalCss,
  getDevGlobalCss,
  __resetDevGlobalCssForTests,
} from '../dev-global-css.js';

describe('manifest globalCss', () => {
  it('normalizes globalCss and defaults it to empty', async () => {
    __resetPreloadModulesForTests();
    installPreloadModules(() => ({ globalCss: ['/static/global-a.css', 7] }));
    const m = await resolvePreloadManifest();
    expect(m.globalCss).toEqual(['/static/global-a.css']);
    __resetPreloadModulesForTests();
    const empty = await resolvePreloadManifest();
    expect(empty.globalCss).toEqual([]);
  });
});

describe('dev global css seam', () => {
  it('round-trips installed dev urls and resets', () => {
    __resetDevGlobalCssForTests();
    expect(getDevGlobalCss()).toBeUndefined();
    installDevGlobalCss(['/src/styles/root.css']);
    expect(getDevGlobalCss()).toEqual(['/src/styles/root.css']);
    __resetDevGlobalCssForTests();
    expect(getDevGlobalCss()).toBeUndefined();
  });
});
```

(Match the existing test file's import style for `installPreloadModules` / `resolvePreloadManifest` / `__resetPreloadModulesForTests`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/preload-modules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`preload-modules.ts`:
- `PreloadManifest` gains `/** Residual global stylesheet URLs, injected render-blocking before route CSS. */ globalCss: string[];`
- `EMPTY` gains `globalCss: []`.
- `normalizeManifest` widens the obj shape to include `globalCss?: unknown` and returns `globalCss: Array.isArray(obj.globalCss) ? obj.globalCss.filter(isString) : []`.

`dev-global-css.ts`:

```ts
// Dev-only delivery of the framework-owned global stylesheet. In `vite dev`
// there is no client build, so the preload artifact has no globalCss; the
// generated core app (serve mode only) installs the source URL(s) here and
// renderPage injects them ahead of any artifact values. Prod never installs
// this (the codegen omits the call outside serve), so it stays undefined.

let devGlobalCss: string[] | undefined;

export function installDevGlobalCss(urls: readonly string[]): void {
  devGlobalCss = [...urls];
}

export function getDevGlobalCss(): readonly string[] | undefined {
  return devGlobalCss;
}

/** Test-only. */
export function __resetDevGlobalCssForTests(): void {
  devGlobalCss = undefined;
}
```

`internal-runtime.ts`: append

```ts
// Dev-mode global stylesheet seam: the generated core app installs the dev
// source URL of `css.global` (serve mode only); renderPage injects it.
export { installDevGlobalCss } from './dev-global-css.js';
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/preload-modules.test.ts && pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/preload-modules.ts packages/server/src/dev-global-css.ts packages/server/src/internal-runtime.ts packages/server/src/__tests__/preload-modules.test.ts
git commit -m "feat(server): globalCss in the preload manifest + dev-global-css seam"
```

---

### Task 7: SSR head injection of the global sheet(s)

**Files:**
- Modify: `packages/server/src/document-shell.ts`
- Modify: `packages/server/src/render.tsx`
- Modify: `packages/server/src/__tests__/document-shell-preload.test.ts`
- Modify: `packages/server/src/__tests__/render-preload.test.tsx`

**Interfaces:**
- Consumes: `PreloadManifest.globalCss`, `getDevGlobalCss` (Task 6).
- Produces: `assembleDocument` accepts `globalStyleSheets?: string[]`, injected between the user head tags and the route sheets; render-critical (counts toward both missing-`</head>` warnings).

- [ ] **Step 1: Write the failing tests**

Append to `document-shell-preload.test.ts` (match its existing helpers/style):

```ts
it('injects global stylesheets after user head tags and before route sheets', () => {
  const html = assembleDocument({
    html: '<html><head><meta charset="utf-8"/></head><body></body></html>',
    head: {},
    globalStyleSheets: ['/static/global-a.css'],
    routeStyleSheets: ['/static/home-b.css'],
  });
  const global = html.indexOf('href="/static/global-a.css"');
  const route = html.indexOf('href="/static/home-b.css"');
  expect(global).toBeGreaterThan(-1);
  expect(route).toBeGreaterThan(global);
  expect(html).toContain('<link rel="stylesheet" href="/static/global-a.css" />');
});

it('warns when a fragment render would drop the global sheet', () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (msg: string) => warnings.push(msg);
  try {
    assembleDocument({
      html: '<div>fragment</div>',
      head: {},
      globalStyleSheets: ['/static/global-a.css'],
    });
  } finally {
    console.warn = original;
  }
  expect(warnings.join('\n')).toContain('render-critical');
});
```

Append to `render-preload.test.tsx` a case where the installed manifest includes `globalCss: ['/static/global-a.css']` and the rendered document contains that stylesheet link before any routeCss link (mirror the file's existing manifest-install setup), plus a dev-seam case: `installDevGlobalCss(['/src/styles/root.css'])` with an empty manifest produces a `/src/styles/root.css` stylesheet link (reset with `__resetDevGlobalCssForTests` in afterEach).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/document-shell-preload.test.ts src/__tests__/render-preload.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`document-shell.ts`:
- Add to the options object:

```ts
  /**
   * The app's global stylesheet URLs (framework-owned delivery via
   * `css.global`): the auto-split residual in prod, the dev source URL in dev.
   * Injected before the route sheets so route rules keep their documented
   * tie-winning cascade position over the global sheet. Render-critical like
   * routeStyleSheets (counts toward the missing-</head> warnings).
   */
  globalStyleSheets?: string[];
```

- Destructure `globalStyleSheets = []`, build `const globalStyleTags = globalStyleSheets.map(styleTag);`, and change the head assembly to:

```ts
  const headTags = [
    ...fontPreloadTags,
    ...preloadTags,
    ...userHeadTags,
    ...globalStyleTags,
    ...routeStyleTags,
  ].join('\n        ');
```

- In both warning guards, replace `routeStyleTags.length > 0` with `routeStyleTags.length + globalStyleTags.length > 0`, and generalize the fragment warning's wording from "the matched route render-critical stylesheet links" to "the render-critical stylesheet links (global and route CSS)".

`render.tsx`:

```ts
import { getDevGlobalCss } from './dev-global-css.js';
// ...
const { closure, routes, routeCss, globalCss } = await resolvePreloadManifest();
// ...
// The framework-owned global stylesheet(s): dev seam first (source URL served
// by the dev server; the artifact is empty in dev), then the build artifact's
// residual sheets. Render-critical, head-only (not in the Link header, v1).
const devGlobalCss = getDevGlobalCss();
const globalStyleSheets = devGlobalCss ? [...devGlobalCss, ...globalCss] : globalCss;
```

and pass `globalStyleSheets` to `assembleDocument`.

- [ ] **Step 4: Run the server suite + typecheck**

Run: `pnpm --filter @hono-preact/server exec vitest run && pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/document-shell.ts packages/server/src/render.tsx packages/server/src/__tests__/
git commit -m "feat(server): inject framework-owned global stylesheets into the SSR head"
```

---

### Task 8: Core-app codegen installs the dev URL (serve mode only)

**Files:**
- Modify: `packages/vite/src/server-entry.ts`
- Modify: `packages/vite/src/hono-preact.ts` (only if the `cssGlobal` thread from Task 5 needs adjusting)
- Create or extend: `packages/vite/src/__tests__/server-entry-codegen.test.ts` (create if no codegen test exists; check `packages/vite/src/__tests__/` first)

**Interfaces:**
- Consumes: `installDevGlobalCss` export (Task 6), `ServerEntryPluginOptions.cssGlobal` (Task 5).
- Produces: `GenerateCoreAppModuleOptions.devGlobalCssUrl?: string`; when set, the generated core app contains `installDevGlobalCss(["<url>"]);`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { generateCoreAppModule } from '../server-entry.js';

const base = {
  layoutAbsPath: '/proj/src/Layout.tsx',
  routesAbsPath: '/proj/src/routes.ts',
  apiAbsPath: undefined,
  appConfigAbsPath: undefined,
  serverRegistryGlob: undefined,
};

describe('core app dev global css install', () => {
  it('installs the dev url when provided', () => {
    const src = generateCoreAppModule({ ...base, devGlobalCssUrl: '/src/styles/root.css' });
    expect(src).toContain(`import { installDevGlobalCss } from 'hono-preact/server/internal/runtime';`);
    expect(src).toContain(`installDevGlobalCss(["/src/styles/root.css"]);`);
  });

  it('emits nothing when absent', () => {
    expect(generateCoreAppModule(base)).not.toContain('installDevGlobalCss');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/server-entry-codegen.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`GenerateCoreAppModuleOptions` gains:

```ts
  /**
   * Root-relative dev URL of the framework-owned global stylesheet (serve mode
   * only; undefined in builds). The core app installs it so renderPage links
   * the dev-served source directly, exactly what a hand-authored `?url` link
   * did. Prod delivery reads the build artifact instead.
   */
  devGlobalCssUrl?: string;
```

In `generateCoreAppModule`, before the `return`:

```ts
  const devGlobalCssInstall = opts.devGlobalCssUrl
    ? `import { installDevGlobalCss } from 'hono-preact/server/internal/runtime';\n` +
      `installDevGlobalCss([${JSON.stringify(opts.devGlobalCssUrl)}]);\n`
    : '';
```

and emit `devGlobalCssInstall` right after the `createServerEntry` import line.

In `serverEntryPlugin`, the `config(userConfig, env)` hook computes and passes it:

```ts
      const devGlobalCssUrl =
        env.command === 'serve' && opts.cssGlobal
          ? '/' +
            path
              .relative(
                root,
                path.isAbsolute(opts.cssGlobal)
                  ? opts.cssGlobal
                  : path.resolve(root, opts.cssGlobal)
              )
              .split(path.sep)
              .join('/')
          : undefined;
```

(passed into `generateCoreAppModule({ ..., devGlobalCssUrl })`; the hook already has `env` available as its second parameter, add it to the signature).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @hono-preact/vite exec vitest run && pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry-codegen.test.ts packages/vite/src/hono-preact.ts
git commit -m "feat(vite): serve-mode codegen installs the dev global stylesheet url"
```

---

### Task 9: Site dogfood (re-merge the monolith, adopt css.global)

**Files:**
- Modify: `apps/site/src/styles/root.css` (absorb the three route sheets)
- Delete: `apps/site/src/styles/home.css`, `apps/site/src/styles/docs.css`, `apps/site/src/styles/demo.css`
- Modify: `apps/site/src/pages/home.tsx`, `apps/site/src/components/DocsLayout.tsx`, `apps/site/src/pages/demo/demo-layout.tsx` (drop the CSS imports)
- Modify: `apps/site/src/Layout.tsx` (drop the `?url` import + link)
- Modify: `apps/site/vite.config.ts` (add `css: { global: 'src/styles/root.css' }`)

**Interfaces:**
- Consumes: everything above. No new interfaces.

- [ ] **Step 1: Capture the pre-change measurement baseline**

From a state where `main`'s site still builds (before editing), or by checking out the base in a scratch dir:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm --filter site build
node scripts/measure-site-chunks.mjs > /tmp/css-split-baseline.json
cat /tmp/css-split-baseline.json
```

Record the `css.global` and per-route numbers; the post-change numbers must land within ~10% per route.

- [ ] **Step 2: Conservation snapshot + merge**

```bash
cd apps/site/src/styles
sort root.css home.css docs.css demo.css | grep -v '^[[:space:]]*$' > /tmp/css-merge-before.txt
cat home.css >> root.css && cat docs.css >> root.css && cat demo.css >> root.css
rm home.css docs.css demo.css
sort root.css | grep -v '^[[:space:]]*$' > /tmp/css-merge-after.txt
diff /tmp/css-merge-before.txt /tmp/css-merge-after.txt && echo CONSERVED
```

Expected: `CONSERVED`. Add a section comment at each seam in `root.css` (e.g. `/* ---- formerly home.css (route-scoped by the auto-splitter) ---- */`).

- [ ] **Step 3: Drop the manual wiring**

- `apps/site/src/pages/home.tsx`: remove `import '@/styles/home.css';`
- `apps/site/src/components/DocsLayout.tsx`: remove `import '@/styles/docs.css';`
- `apps/site/src/pages/demo/demo-layout.tsx`: remove `import '@/styles/demo.css';`
- `apps/site/src/Layout.tsx`: remove `import root from '@/styles/root.css?url';` and the `<link rel="stylesheet" href={root} />` line.
- `apps/site/vite.config.ts`: change the preset call to

```ts
    honoPreact({
      adapter: cloudflareAdapter(),
      css: { global: 'src/styles/root.css' },
    }),
```

- [ ] **Step 4: Build and inspect the split**

```bash
pnpm --filter site build
node -e "
const m = require('/Users/stevenbeshensky/Documents/repos/hono-preact/apps/site/dist/client/__hp-preload.json');
console.log('globalCss:', m.globalCss);
for (const p of ['/', '/docs/quick-start', '/demo']) console.log(p, m.routeCss[p]);
"
node scripts/measure-site-chunks.mjs
```

Expected: `globalCss` has one hashed `global-*.css`; `/` lists a `home-*.scoped.css` (plus any Layer 1 leftovers); docs and demo patterns list their scoped sheets; per-route and global sizes within ~10% of the Step 1 baseline. Investigate any route whose CSS grew materially (likely a class string leaking into a shared chunk; acceptable if small, note it).

- [ ] **Step 5: Runtime verification (dev and preview)**

```bash
cd apps/site && timeout 60 pnpm dev &
sleep 15
curl -s http://localhost:5173/ | grep -o '<link rel="stylesheet"[^>]*>' 
```

Expected: a stylesheet link to `/src/styles/root.css` (dev seam) and NO 404s; then kill the dev server. For prod behavior:

```bash
cd apps/site && timeout 90 pnpm preview &  # or wrangler dev per the site's scripts
sleep 20
for p in / /docs/quick-start /demo; do
  curl -s "http://localhost:4173$p" | grep -o '<link rel="stylesheet"[^>]*>';
done
```

Expected per page: the `global-*.css` link first, then that route's scoped sheet(s); fetch one scoped URL and confirm HTTP 200 with CSS content. (Adjust the port/serve command to the site's actual preview script; check `apps/site/package.json`.)

- [ ] **Step 6: Run the site test suite**

Run: `pnpm --filter site test` (or the repo's equivalent; check `apps/site/package.json` scripts) and `pnpm test:coverage` at the root.
Expected: PASS. `apps/site/src/pages/__tests__/home.test.tsx` and friends may import the deleted CSS files transitively; fix any imports the removals broke.

- [ ] **Step 7: Commit**

```bash
git add apps/site
git commit -m "feat(site): dogfood css auto-split (re-merged monolith, framework-owned delivery)"
```

---

### Task 10: Docs, agents corpus, measure-script comment sync

**Files:**
- Modify: `apps/site/src/pages/docs/styling.mdx`
- Modify: `scripts/measure-site-chunks.mjs` (comments + explicit `globalCss` handling)
- Modify: `scripts/__tests__/measure-site-chunks.test.mjs` (only if assertions reference the changed comments/behavior)

**Interfaces:** none new.

- [ ] **Step 1: Rewrite the styling guide**

`styling.mdx` restructure (keep the existing frontmatter/nav wiring):
1. **Default path: one global stylesheet.** `honoPreact({ css: { global: 'src/styles/root.css' } })`; the framework injects it (dev and prod) and, at build time, auto-splits route-exclusive rules into per-route sheets delivered render-blocking for the matched route. State the contract: scoped rules behave exactly as if hand-split (route sheets load after the global sheet and win equal-specificity ties). Options table: `global`, `autoSplit` (default true), `minSize` (default 1024).
2. **How attribution works + the documented limitation** (verbatim per the spec): a rule is scoped only when every class in it appears in exactly one route's JS; runtime-constructed class names and classes that appear only in server data cannot be seen, so those rules stay global (safe). Breakage requires the double failure (dynamically constructed by one route AND literal in exactly one other chunk); if you hit it, hand-split that rule into a route sheet or set `autoSplit: false`.
3. **Explicit-control path: hand-split route sheets** (the existing Layer 1 content, condensed): import a stylesheet from a route module and it ships only on that route; composes with auto-split.
4. Keep the Lightning CSS translate/scale/rotate gotcha callout, now framed as applying to all framework CSS (the preset's minifier), and note `cssMinify`/`css.lightningcss` user overrides win.

Remember the docs rules: no historical breadcrumbs ("formerly", "replaces"), describe what is.

- [ ] **Step 2: Measure-script sync**

In `measure-site-chunks.mjs`, update the stale comment block above `PRELOAD_MANIFEST_FILE` (it says the global sheet is "linked by the Layout") to describe the artifact's `globalCss` field, and make global identification explicit rather than purely heuristic:

```js
  const { routeCss = {}, globalCss = [] } = JSON.parse(readFileSync(manifestPath, 'utf8'));
```

and include `globalCss.map(cssFile)` files in the global measurement set (union with the existing unreferenced-files heuristic, deduped), so the number is exact even if a future change leaves an unreferenced stray.

- [ ] **Step 3: Regenerate the corpus + run script tests**

```bash
pnpm gen:agents-corpus
node --test scripts/__tests__/  # or the repo's script-test invocation; check package.json
node scripts/measure-site-chunks.mjs
```

Expected: corpus regenerated (styling guide flows in), script tests pass, measurement prints sane global + per-route numbers.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs/styling.mdx scripts/
git commit -m "docs(site): styling guide covers css auto-split; measure script reads globalCss"
```

---

### Task 11: Full verification + PR

**Files:** none (verification only).

- [ ] **Step 1: The 8 CI-parity steps, in CI order**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check   # run `pnpm format` first if it fails, and commit
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all green. Do not push until personally seen green.

- [ ] **Step 2: Behavioral spot-check of the built site**

Serve the built worker (`wrangler dev` via the site's scripts) and verify, for `/`, `/docs/quick-start`, and `/demo`:
- global sheet link present and 200,
- route-scoped sheet(s) present, 200, containing route-appropriate selectors (`.hx-` on home, `.mdx-` on docs),
- no selector visibly missing (load each page in a browser if available; otherwise diff the union of served CSS against the monolith rule count),
- the translate/scale/rotate gotcha still holds no regressions: `rg 'translate:' apps/site/dist/client/static/*.css` returns nothing unexpected alongside `transform` (per the documented gotcha).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin <branch>
gh pr create --title "feat: CSS auto-split (Lightning CSS monolith splitting, #249 Layer 3)" --body "<summary + spec link + measurement table>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Then, per the repo's PR workflow, immediately run the deep PR review (REVIEW.md) as the first follow-up.
