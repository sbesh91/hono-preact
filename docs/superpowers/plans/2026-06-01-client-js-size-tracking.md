# Client JS Size Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every PR, post a sticky comment with the client JS size broken into framework-runtime-per-feature and site-bundle buckets, each diffed against a committed baseline with soft (non-blocking) budgets, and capture a per-main-commit size history.

**Architecture:** Three plain-ESM Node scripts at repo root. `client-size-config.mjs` holds the feature manifest, site-chunk bucket prefixes, and budgets plus a pure `bucketForChunk` helper. `measure-client-size.mjs` bundles each feature's iso `dist/` modules in isolation with esbuild (peers external), gzip/brotli-sizes them, reads the site's emitted chunks, and writes `client-size-report.json`; with `--append-history` it appends one row to `client-size-history.jsonl`. `render-size-comment.mjs` is a pure function turning (fresh, baseline, config) into markdown, plus a CLI. CI runs measure+render on PRs and posts via a sticky-comment action; on `main` pushes it regenerates the baseline and appends history.

**Tech Stack:** Node ESM (`.mjs`), esbuild (isolated bundling), `node:zlib` (gzip/brotli), Vitest (tests), GitHub Actions + `marocchino/sticky-pull-request-comment`.

---

## File Structure

- `scripts/client-size-config.mjs` (create) — pure data + helpers: `CORE_MODULES`, `FEATURE_MODULES` (bucket → iso dist basenames), `EXTERNAL` (esbuild externals), `CHUNK_PREFIXES` (ordered prefix → bucket), `BUDGETS` (bucket → gzip bytes), and pure functions `bucketForChunk(filename)`, `tableGzip(bucket, entry)`.
- `scripts/measure-client-size.mjs` (create) — measurement + CLI. Exports `bundleSize`, `measureSectionA`, `measureSectionB`, `buildReport`, `historyRow`. CLI writes the report and (with `--append-history`) the history line.
- `scripts/render-size-comment.mjs` (create) — exports pure `renderComment(fresh, baseline, config)`; CLI reads two JSON paths and prints markdown.
- `scripts/__tests__/client-size-config.test.mjs` (create) — `bucketForChunk` grouping.
- `scripts/__tests__/measure-client-size.test.mjs` (create) — `bundleSize` smoke + `historyRow` shape.
- `scripts/__tests__/render-size-comment.test.mjs` (create) — markdown rendering for unchanged/increase/decrease/new/removed/over-budget.
- `vitest.config.ts` (modify) — add `'scripts/__tests__/**/*.test.mjs'` to `test.include`.
- `package.json` (modify) — add `esbuild` devDependency.
- `.github/workflows/ci.yml` (modify) — add `client-size` PR job + history/baseline step on the `main` job.
- `client-size-report.json` (create) — committed baseline snapshot at repo root.
- `client-size-history.jsonl` (create) — committed append-only history at repo root.

Reference spec: `docs/superpowers/specs/2026-06-01-client-js-size-tracking-design.md`.

---

### Task 1: Config module + chunk-bucket helper

**Files:**
- Create: `scripts/client-size-config.mjs`
- Modify: `vitest.config.ts` (add scripts test glob)
- Test: `scripts/__tests__/client-size-config.test.mjs`

- [ ] **Step 1: Add the scripts test glob to vitest include**

In `vitest.config.ts`, the `test.include` array currently ends with `'apps/site/src/**/__tests__/**/*.test.{ts,tsx}',`. Add a line after it:

```ts
      'apps/site/src/**/__tests__/**/*.test.{ts,tsx}',
      'scripts/__tests__/**/*.test.mjs',
```

- [ ] **Step 2: Write the failing test**

Create `scripts/__tests__/client-size-config.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { bucketForChunk } from '../client-size-config.mjs';

describe('bucketForChunk', () => {
  it('maps framework chunks to their feature buckets', () => {
    expect(bucketForChunk('guard-DJLFP2aQ.js')).toBe('guards');
    expect(bucketForChunk('loader-stub-BBx7s-oQ.js')).toBe('loaders');
    expect(bucketForChunk('loaders-Cb82m1UO.js')).toBe('loaders');
    expect(bucketForChunk('optimistic-ui-VlGv6y5e.js')).toBe('actions');
    expect(bucketForChunk('use-form-status-DYpR2niF.js')).toBe('actions');
    expect(bucketForChunk('view-transitions-CW4lqKHP.js')).toBe('transitions');
    expect(bucketForChunk('view-transition-name-DuHeharv.js')).toBe(
      'transitions'
    );
    expect(bucketForChunk('prefetch-B_HAewv0.js')).toBe('prefetch');
    expect(bucketForChunk('link-prefetch-D7NuYjWG.js')).toBe('prefetch');
    expect(bucketForChunk('sse-decoder-BsANPN5m.js')).toBe('streaming');
    expect(bucketForChunk('hono-middleware-CQF6FPxB.js')).toBe('middleware');
    expect(bucketForChunk('router-DTudL682.js')).toBe('core');
    expect(bucketForChunk('client.js')).toBe('core');
    expect(bucketForChunk('hoofd.module-BYkN5Afl.js')).toBe('vendor');
  });

  it('falls back to app for unmatched chunks', () => {
    expect(bucketForChunk('home-CGHL1ScW.js')).toBe('app');
    expect(bucketForChunk('DocsRoute-Du9xdgnk.js')).toBe('app');
  });

  it('does not let a short prefix swallow a sibling name', () => {
    // "loaders" must not be captured by a hypothetical "loader-stub" rule, and
    // "loading-states" must not be captured by "loader".
    expect(bucketForChunk('loading-states-xNzUIjIC.js')).toBe('core');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run scripts/__tests__/client-size-config.test.mjs`
Expected: FAIL — cannot resolve `../client-size-config.mjs`.

- [ ] **Step 4: Write the config module**

Create `scripts/client-size-config.mjs`:

```js
// Pure configuration + helpers for client JS size tracking. No I/O here so it
// is trivially unit-testable. See docs/superpowers/specs/2026-06-01-client-js-
// size-tracking-design.md.

// Section A: framework runtime cost per feature. Each bucket lists the iso
// dist module basenames whose public surface defines that feature. Paths are
// resolved against packages/iso/dist/ by the measure script.
export const CORE_MODULES = [
  'define-app.js',
  'define-routes.js',
  'define-page.js',
  'page.js',
  'client-script.js',
  'route-change.js',
  'is-browser.js',
];

export const FEATURE_MODULES = {
  loaders: ['define-loader.js', 'cache.js'],
  actions: [
    'action.js',
    'form.js',
    'optimistic.js',
    'optimistic-action.js',
    'outcomes.js',
    'action-result-context.js',
    'use-action-result.js',
    'use-form-status.js',
  ],
  transitions: [
    'view-transition-lifecycle.js',
    'view-transition-name.js',
    'view-transition-types.js',
    'view-transitions.js',
  ],
  prefetch: ['prefetch.js'],
  streaming: ['define-stream-observer.js'],
  guards: ['guard.js'],
  head: ['head.js'],
  persist: ['persist.js'],
  middleware: ['define-middleware.js', 'reload-context.js'],
};

// Peers a consumer already has; excluded so Section A measures only the
// framework's own code on top of preact. Anything NOT listed here (e.g. a
// third-party dep a feature drags in) is intentionally counted as that
// feature's cost.
export const EXTERNAL = [
  'preact',
  'preact/*',
  'preact-iso',
  'preact-iso/*',
  'hono',
  'hono/*',
];

// Section B: ordered prefix -> bucket for the site's emitted chunks. A prefix
// matches a filename `${name}.js` exactly or any `${name}-<hash>.js`. First
// match wins; unmatched chunks fall through to 'app'. Keep prefixes explicit
// (no ambiguous short stems) so ordering rarely matters.
export const CHUNK_PREFIXES = [
  ['guard', 'guards'],
  ['loader-stub', 'loaders'],
  ['loaders', 'loaders'],
  ['optimistic-ui', 'actions'],
  ['use-form-status', 'actions'],
  ['actions', 'actions'],
  ['view-transition-name', 'transitions'],
  ['view-transition-types', 'transitions'],
  ['view-transitions', 'transitions'],
  ['link-prefetch', 'prefetch'],
  ['prefetch', 'prefetch'],
  ['sse-decoder', 'streaming'],
  ['stream-registry', 'streaming'],
  ['streaming', 'streaming'],
  ['hono-middleware', 'middleware'],
  ['middleware', 'middleware'],
  ['reloading', 'middleware'],
  ['router', 'core'],
  ['routes', 'core'],
  ['route-change', 'core'],
  ['render-page', 'core'],
  ['define-page', 'core'],
  ['pages', 'core'],
  ['layouts', 'core'],
  ['structure', 'core'],
  ['is-browser', 'core'],
  ['loading-states', 'core'],
  ['history-shim', 'core'],
  ['csrf', 'core'],
  ['websockets', 'core'],
  ['client', 'core'],
  ['hoofd.module', 'vendor'],
  ['hooks.module', 'vendor'],
  ['jsxRuntime.module', 'vendor'],
  ['preload-helper', 'vendor'],
];

// Soft budgets in gzip bytes per bucket. A bucket over budget renders a ⚠️ in
// the comment but never fails CI. Buckets without an entry have no budget.
export const BUDGETS = {
  // Section A (marginal-over-core gzip, except `core` which is its own total):
  core: 16000,
  // Section B grand total:
  'site:total': 40000,
};

// True if a site chunk filename belongs to `bucket` under `prefix`.
function prefixMatches(filename, prefix) {
  return filename === `${prefix}.js` || filename.startsWith(`${prefix}-`);
}

// Maps a single emitted chunk filename to its bucket; 'app' if unmatched.
export function bucketForChunk(filename) {
  for (const [prefix, bucket] of CHUNK_PREFIXES) {
    if (prefixMatches(filename, prefix)) return bucket;
  }
  return 'app';
}

// The gzip number shown in the Section A table for a bucket: `core` shows its
// own total; every other feature shows its marginal cost over core.
export function tableGzip(bucket, entry) {
  return bucket === 'core' ? entry.total.gzip : entry.marginalOverCore.gzip;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run scripts/__tests__/client-size-config.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/client-size-config.mjs scripts/__tests__/client-size-config.test.mjs vitest.config.ts
git commit -m "feat(size): client-size config + chunk-bucket helper"
```

---

### Task 2: Section A measurement (isolated feature bundles)

**Files:**
- Create: `scripts/measure-client-size.mjs`
- Modify: `package.json` (add esbuild devDependency)
- Test: `scripts/__tests__/measure-client-size.test.mjs`

- [ ] **Step 1: Add esbuild as a root devDependency**

esbuild is only transitively present today (`node -e "import('esbuild')"` fails at root). Add it explicitly. In root `package.json`, add to `devDependencies` (keep alphabetical):

```json
    "esbuild": "^0.27.0",
```

Then install:

Run: `pnpm install`
Expected: lockfile updates; `node -e "import('esbuild').then(e=>console.log(e.version))"` prints a 0.27.x version.

- [ ] **Step 2: Write the failing test**

Create `scripts/__tests__/measure-client-size.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { bundleSize } from '../measure-client-size.mjs';

describe('bundleSize', () => {
  it('returns positive gzip/brotli sizes for a real iso module', async () => {
    // Re-export a small iso dist module by namespace so sideEffects:false
    // tree-shaking cannot drop it (entry-point exports are always kept).
    const entry = `export * as m from './packages/iso/dist/is-browser.js';`;
    const size = await bundleSize(entry, process.cwd());
    expect(size.gzip).toBeGreaterThan(0);
    expect(size.brotli).toBeGreaterThan(0);
    expect(size.raw).toBeGreaterThanOrEqual(size.gzip);
  });

  it('excludes peers (external) from the measured bytes', async () => {
    const withPreact = `export * as h from 'preact';`;
    const size = await bundleSize(withPreact, process.cwd());
    // preact is external, so the bundle is just a re-export shim: tiny.
    expect(size.raw).toBeLessThan(200);
  });
});
```

This test requires `packages/iso/dist` to exist. The framework build runs before tests in CI (and the pre-push sequence); locally run `pnpm --filter '@hono-preact/*' --filter hono-preact build` first if needed.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run scripts/__tests__/measure-client-size.test.mjs`
Expected: FAIL — cannot resolve `../measure-client-size.mjs`.

- [ ] **Step 4: Write the measurement module (Section A only for now)**

Create `scripts/measure-client-size.mjs`:

```js
#!/usr/bin/env node
// Measures client JS size: Section A (framework runtime per feature, isolated
// esbuild bundles, peers external) and Section B (site emitted chunks grouped
// into buckets). Writes client-size-report.json; with --append-history appends
// one gzip-only row to client-size-history.jsonl.
//
// Usage:
//   node scripts/measure-client-size.mjs                 # write report
//   node scripts/measure-client-size.mjs --out /tmp/x.json
//   node scripts/measure-client-size.mjs --append-history --sha <sha> --date <iso>

import { build } from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_MODULES,
  FEATURE_MODULES,
  EXTERNAL,
  bucketForChunk,
  tableGzip,
} from './client-size-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_VERSION = 1;

// Bundle an entry source string in isolation and return its sizes in bytes.
export async function bundleSize(entryContents, resolveDir) {
  const result = await build({
    stdin: { contents: entryContents, resolveDir, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    external: EXTERNAL,
    legalComments: 'none',
    logLevel: 'silent',
  });
  const code = Buffer.from(result.outputFiles[0].contents);
  return {
    raw: code.length,
    gzip: gzipSync(code).length,
    brotli: brotliCompressSync(code).length,
  };
}

// Build an entry that namespace-re-exports each iso dist module so nothing is
// tree-shaken (sideEffects:false would otherwise drop side-effect-free imports).
function entryFor(modules) {
  return modules
    .map((m, i) => `export * as m${i} from './packages/iso/dist/${m}';`)
    .join('\n');
}

// Section A: core total, then each feature's total (isolated) and marginal
// cost over core (= (core+feature) bundle - core bundle, robust to shared deps).
export async function measureSectionA() {
  const core = await bundleSize(entryFor(CORE_MODULES), ROOT);
  const sectionA = {
    core: { total: core, marginalOverCore: core },
  };
  for (const [bucket, modules] of Object.entries(FEATURE_MODULES)) {
    const total = await bundleSize(entryFor(modules), ROOT);
    const combined = await bundleSize(
      entryFor([...CORE_MODULES, ...modules]),
      ROOT
    );
    sectionA[bucket] = {
      total,
      marginalOverCore: {
        gzip: Math.max(0, combined.gzip - core.gzip),
        brotli: Math.max(0, combined.brotli - core.brotli),
      },
    };
  }
  return sectionA;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run scripts/__tests__/measure-client-size.test.mjs`
Expected: PASS (2 tests). If it errors that `packages/iso/dist` is missing, run `pnpm --filter '@hono-preact/*' --filter hono-preact build` first.

- [ ] **Step 6: Commit**

```bash
git add scripts/measure-client-size.mjs scripts/__tests__/measure-client-size.test.mjs package.json pnpm-lock.yaml
git commit -m "feat(size): esbuild isolated Section A measurement"
```

---

### Task 3: Section B measurement (site chunk grouping) + report assembly

**Files:**
- Modify: `scripts/measure-client-size.mjs`
- Test: `scripts/__tests__/measure-client-size.test.mjs`

- [ ] **Step 1: Write the failing test (append)**

Append to `scripts/__tests__/measure-client-size.test.mjs`:

```js
import { measureSectionB, historyRow } from '../measure-client-size.mjs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('measureSectionB', () => {
  it('gzip-sizes files and sums them into buckets + total', () => {
    const dir = mkdtempSync(join(tmpdir(), 'size-'));
    const staticDir = join(dir, 'client', 'static');
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, 'guard-AAA.js'), 'a'.repeat(500));
    writeFileSync(join(staticDir, 'router-BBB.js'), 'b'.repeat(500));
    writeFileSync(join(staticDir, 'home-CCC.js'), 'c'.repeat(500));

    const section = measureSectionB(dir);
    expect(section.buckets.guards).toBeGreaterThan(0);
    expect(section.buckets.core).toBeGreaterThan(0);
    expect(section.buckets.app).toBeGreaterThan(0);
    expect(section.total).toBe(
      section.buckets.guards + section.buckets.core + section.buckets.app
    );
  });
});

describe('historyRow', () => {
  it('produces a gzip-only row stamped with the passed sha/date', () => {
    const report = {
      sectionA: {
        core: { total: { gzip: 100 }, marginalOverCore: { gzip: 100 } },
        actions: { total: { gzip: 80 }, marginalOverCore: { gzip: 30 } },
      },
      sectionB: { buckets: { core: 200, app: 50 }, total: 250 },
    };
    const row = historyRow(report, 'abc123', '2026-06-01T00:00:00Z');
    expect(row).toEqual({
      sha: 'abc123',
      date: '2026-06-01T00:00:00Z',
      sectionA: { core: 100, actions: 30 },
      sectionB: { buckets: { core: 200, app: 50 }, total: 250 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/__tests__/measure-client-size.test.mjs`
Expected: FAIL — `measureSectionB`/`historyRow` are not exported.

- [ ] **Step 3: Implement Section B, report assembly, history row, and CLI**

Append to `scripts/measure-client-size.mjs`:

```js
// Section B: gzip-size every emitted client chunk and group into buckets.
// `distDir` is the site's build output root (contains client/static/*.js).
export function measureSectionB(distDir) {
  const staticDir = join(distDir, 'client', 'static');
  const files = readdirSync(staticDir).filter((f) => f.endsWith('.js'));
  const buckets = {};
  let total = 0;
  let unmatched = 0;
  for (const file of files) {
    const bucket = bucketForChunk(file);
    if (bucket === 'app' && file !== 'app.js') unmatched++;
    const gz = gzipSync(readFileSync(join(staticDir, file))).length;
    buckets[bucket] = (buckets[bucket] ?? 0) + gz;
    total += gz;
  }
  return { buckets, total, unmatched, fileCount: files.length };
}

// Assemble the full committed report from both sections.
export async function buildReport(distDir) {
  return {
    version: REPORT_VERSION,
    sectionA: await measureSectionA(),
    sectionB: measureSectionB(distDir),
  };
}

// Flatten a report into a gzip-only history row stamped with sha/date.
export function historyRow(report, sha, date) {
  const sectionA = {};
  for (const [bucket, entry] of Object.entries(report.sectionA)) {
    sectionA[bucket] = tableGzip(bucket, entry);
  }
  return {
    sha,
    date,
    sectionA,
    sectionB: { buckets: report.sectionB.buckets, total: report.sectionB.total },
  };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const distDir = arg('dist') ?? join(ROOT, 'apps/site/dist');
  const outPath = arg('out') ?? join(ROOT, 'client-size-report.json');
  const report = await buildReport(distDir);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${outPath} (site total ${report.sectionB.total} B gzip)`);
  if (report.sectionB.unmatched > 0) {
    console.log(
      `Note: ${report.sectionB.unmatched} chunk(s) fell through to the 'app' bucket.`
    );
  }
  if (process.argv.includes('--append-history')) {
    const sha = arg('sha');
    const date = arg('date');
    if (!sha || !date) {
      console.error('--append-history requires --sha and --date');
      process.exit(1);
    }
    const historyPath = join(ROOT, 'client-size-history.jsonl');
    appendFileSync(historyPath, JSON.stringify(historyRow(report, sha, date)) + '\n');
    console.log(`Appended history row for ${sha} to ${historyPath}`);
  }
}
```

Note the unused-import cleanup: `measure-client-size.mjs` now uses `writeFileSync` and `appendFileSync` (already imported in Task 2 Step 4).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scripts/__tests__/measure-client-size.test.mjs`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add scripts/measure-client-size.mjs scripts/__tests__/measure-client-size.test.mjs
git commit -m "feat(size): Section B chunk grouping, report assembly, history row, CLI"
```

---

### Task 4: Render the PR comment markdown

**Files:**
- Create: `scripts/render-size-comment.mjs`
- Test: `scripts/__tests__/render-size-comment.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/render-size-comment.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { renderComment } from '../render-size-comment.mjs';

const cfg = { BUDGETS: { core: 16000, 'site:total': 40000 } };

function report(over = {}) {
  return {
    sectionA: {
      core: { total: { gzip: 15000 }, marginalOverCore: { gzip: 15000 } },
      actions: { total: { gzip: 8000 }, marginalOverCore: { gzip: 3000 } },
      loaders: { total: { gzip: 4000 }, marginalOverCore: { gzip: 1000 } },
      ...over.sectionA,
    },
    sectionB: { buckets: { core: 20000, app: 12000 }, total: 32000, ...over.sectionB },
  };
}

describe('renderComment', () => {
  it('shows a dash for unchanged buckets', () => {
    const md = renderComment(report(), report(), cfg);
    expect(md).toContain('Client JS size');
    expect(md).toMatch(/core.*15\.0 KB.*—/s);
  });

  it('shows + delta for an increase and - for a decrease', () => {
    const baseline = report();
    const fresh = report({
      sectionA: {
        actions: { total: { gzip: 8000 }, marginalOverCore: { gzip: 4500 } },
      },
      sectionB: { buckets: { core: 20000, app: 11000 }, total: 31000 },
    });
    const md = renderComment(fresh, baseline, cfg);
    expect(md).toContain('+1.5 KB'); // actions marginal 3000 -> 4500
    expect(md).toContain('-1.0 KB'); // site total 32000 -> 31000
  });

  it('flags a bucket over budget with a warning', () => {
    const fresh = report({
      sectionA: {
        core: { total: { gzip: 18000 }, marginalOverCore: { gzip: 18000 } },
      },
    });
    const md = renderComment(fresh, report(), cfg);
    expect(md).toContain('⚠️');
    expect(md).toContain('18.0 KB / 16.0 KB');
  });

  it('marks new and removed buckets', () => {
    const baseline = report();
    const fresh = report({
      sectionA: {
        persist: { total: { gzip: 900 }, marginalOverCore: { gzip: 600 } },
      },
    });
    // Remove "loaders" from fresh to simulate a removed bucket.
    delete fresh.sectionA.loaders;
    const md = renderComment(fresh, baseline, cfg);
    expect(md).toContain('(new)');
    expect(md).toContain('(removed)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/__tests__/render-size-comment.test.mjs`
Expected: FAIL — cannot resolve `../render-size-comment.mjs`.

- [ ] **Step 3: Implement the renderer**

Create `scripts/render-size-comment.mjs`:

```js
#!/usr/bin/env node
// Pure renderer: turns (freshReport, baselineReport, config) into the sticky PR
// comment markdown. CLI form reads two JSON files and prints the markdown.

import { readFileSync } from 'node:fs';
import * as defaultConfig from './client-size-config.mjs';

const COMMENT_HEADER = '<!-- client-size -->';

// 1000-based KB with one decimal (e.g. 15000 -> "15.0 KB", 1500 -> "1.5 KB"),
// raw bytes under 1000 (e.g. 900 -> "900 B"). 1000-based keeps the displayed
// numbers readable against the round byte counts these reports produce.
function fmtBytes(n) {
  if (Math.abs(n) < 1000) return `${n} B`;
  return `${(n / 1000).toFixed(1)} KB`;
}

function fmtDelta(fresh, base) {
  if (base === undefined) return '(new)';
  const d = fresh - base;
  if (d === 0) return '—';
  return (d > 0 ? '+' : '-') + fmtBytes(Math.abs(d));
}

// One table row: "| name | size | delta | flag |".
function row(name, freshGzip, baseGzip, budget) {
  if (freshGzip === undefined) return `| ${name} | (removed) | |`;
  const sizeCell =
    budget !== undefined && freshGzip > budget
      ? `⚠️ ${fmtBytes(freshGzip)} / ${fmtBytes(budget)}`
      : fmtBytes(freshGzip);
  return `| ${name} | ${sizeCell} | ${fmtDelta(freshGzip, baseGzip)} |`;
}

function sectionAGzip(report, bucket) {
  const e = report.sectionA[bucket];
  if (!e) return undefined;
  return bucket === 'core' ? e.total.gzip : e.marginalOverCore.gzip;
}

export function renderComment(fresh, baseline, config = defaultConfig) {
  const budgets = config.BUDGETS ?? {};
  const lines = [COMMENT_HEADER, '## Client JS size', ''];

  // Section A
  lines.push('### Framework runtime (gzip; `core` is total, features marginal over core)');
  lines.push('| Feature | Size | Δ vs base |');
  lines.push('|---|---|---|');
  const aBuckets = new Set([
    ...Object.keys(fresh.sectionA),
    ...Object.keys(baseline.sectionA),
  ]);
  for (const bucket of aBuckets) {
    lines.push(
      row(bucket, sectionAGzip(fresh, bucket), sectionAGzip(baseline, bucket), budgets[bucket])
    );
  }
  lines.push('');

  // Section B
  lines.push('### Site bundle (gzip)');
  lines.push('| Bucket | Size | Δ vs base |');
  lines.push('|---|---|---|');
  const bBuckets = new Set([
    ...Object.keys(fresh.sectionB.buckets),
    ...Object.keys(baseline.sectionB.buckets),
  ]);
  for (const bucket of bBuckets) {
    lines.push(
      row(bucket, fresh.sectionB.buckets[bucket], baseline.sectionB.buckets[bucket], budgets[bucket])
    );
  }
  lines.push(
    row('**total**', fresh.sectionB.total, baseline.sectionB.total, budgets['site:total'])
  );
  lines.push('');
  lines.push('<sub>Budgets are advisory; overages flag ⚠️ but never fail CI.</sub>');
  return lines.join('\n');
}

// CLI: render-size-comment.mjs <freshReport.json> <baselineReport.json>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [freshPath, basePath] = process.argv.slice(2);
  const fresh = JSON.parse(readFileSync(freshPath, 'utf8'));
  const baseline = JSON.parse(readFileSync(basePath, 'utf8'));
  process.stdout.write(renderComment(fresh, baseline));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scripts/__tests__/render-size-comment.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/render-size-comment.mjs scripts/__tests__/render-size-comment.test.mjs
git commit -m "feat(size): render sticky PR comment markdown"
```

---

### Task 5: Generate the committed baseline + history seed

**Files:**
- Create: `client-size-report.json`
- Create: `client-size-history.jsonl`

- [ ] **Step 1: Build the framework + site**

Run:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm --filter site build
```
Expected: both builds succeed; `apps/site/dist/client/static/*.js` exists.

- [ ] **Step 2: Generate the baseline report**

Run: `node scripts/measure-client-size.mjs`
Expected: prints `Wrote .../client-size-report.json (site total <N> B gzip)`. Open `client-size-report.json` and sanity check: `sectionA.core.total.gzip` is in the low-tens-of-KB, every feature in `FEATURE_MODULES` is present, and `sectionB.total` is positive. If the run logs unmatched chunks, eyeball them and, if any belong in a real bucket, add a prefix to `CHUNK_PREFIXES` in `client-size-config.mjs` and re-run.

- [ ] **Step 3: Seed the history file with the current commit**

Run:
```bash
node scripts/measure-client-size.mjs --append-history --sha "$(git rev-parse HEAD)" --date "$(git show -s --format=%cI HEAD)"
```
Expected: `client-size-history.jsonl` now has exactly one JSON line. Verify: `wc -l client-size-history.jsonl` prints `1`.

- [ ] **Step 4: Tune budgets to reality**

Open `client-size-config.mjs`. Set `BUDGETS.core` to roughly the measured `sectionA.core.total.gzip` rounded up to a round number with ~10% headroom, and `BUDGETS['site:total']` to the measured `sectionB.total` rounded up similarly. The point of soft budgets is to flag *regressions past today's size*, not to fail immediately.

- [ ] **Step 5: Commit**

```bash
git add client-size-report.json client-size-history.jsonl scripts/client-size-config.mjs
git commit -m "chore(size): seed committed baseline + history, tune budgets"
```

---

### Task 6: Wire CI (PR comment job + main-push baseline/history update)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the PR size-comment job**

In `.github/workflows/ci.yml`, after the `test` job and before `build-and-tag`, add a new job. It reuses the build commands the `test` job already runs, then measures the PR head, diffs against the committed baseline, and posts the comment.

```yaml
  client-size:
    name: Client JS size
    needs: test
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.18.3

      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build framework packages
        run: pnpm --filter '@hono-preact/*' --filter hono-preact build

      - name: Build site
        run: pnpm --filter site build

      - name: Measure PR head
        run: node scripts/measure-client-size.mjs --out /tmp/fresh-size.json

      - name: Render comment
        run: node scripts/render-size-comment.mjs /tmp/fresh-size.json client-size-report.json > /tmp/size-comment.md

      - name: Post sticky comment
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: client-size
          path: /tmp/size-comment.md
```

- [ ] **Step 2: Add the baseline/history update to the main-push job**

In the existing `build-and-tag` job (runs on push to `main`), after the `Build all packages and app` step and before `Move next tag to HEAD`, add a step that regenerates the baseline, appends a history row, and commits if anything changed:

```yaml
      - name: Update client size baseline + history
        run: |
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git config user.name "github-actions[bot]"
          node scripts/measure-client-size.mjs \
            --append-history \
            --sha "$GITHUB_SHA" \
            --date "$(git show -s --format=%cI "$GITHUB_SHA")"
          if ! git diff --quiet client-size-report.json client-size-history.jsonl; then
            git add client-size-report.json client-size-history.jsonl
            git commit -m "chore(size): update client size baseline + history [skip ci]"
            git push origin HEAD:main
          fi
```

Note: the `build-and-tag` job already declares `permissions: contents: write`, which covers this push. `[skip ci]` prevents the size commit from re-triggering CI.

- [ ] **Step 3: Validate the workflow YAML locally**

Confirm the new job/step indentation matches the surrounding YAML by eye, then lint if `actionlint` is available:

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/ci.yml || echo "actionlint not installed; skipping"`
Expected: no errors (or the skip message).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(size): PR size comment + main-push baseline/history update"
```

---

### Task 7: Full local CI mirror + final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full pre-push CI sequence**

Per `CLAUDE.md`, mirror CI in order:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: every step passes. `format:check` does not cover `scripts/**` (the prettier globs are `packages/**` and `apps/**/src`), so the new scripts are not format-gated; this is fine. If `format:check` fails on any other file, run `pnpm format` and commit.

- [ ] **Step 2: Confirm the new tests ran**

Run: `pnpm vitest run scripts/__tests__`
Expected: all three test files pass (config grouping, measure smoke + history, render markdown).

- [ ] **Step 3: Dry-run the comment end to end**

Run: `node scripts/render-size-comment.mjs client-size-report.json client-size-report.json`
Expected: prints the two-section markdown with every delta showing `—` (comparing the baseline to itself).

- [ ] **Step 4: Final commit (if anything changed in Step 1)**

```bash
git add -A
git commit -m "chore(size): pre-push CI mirror clean"
```

---

## Notes / caveats

- **Fork PRs:** `GITHUB_TOKEN` is read-only for PRs from forks, so the sticky comment step will no-op there. This repo is single-author with same-repo PRs, so it is a non-issue; revisit (e.g. `pull_request_target`) only if outside contributors arrive.
- **Build cost:** the `client-size` job builds the framework + site again (it does not share artifacts with `test`). That is the simple, robust choice; if CI minutes become a concern later, cache or artifact-share the site `dist`.
- **`marginalOverCore` semantics:** computed as `(core+feature) − core` gzip/brotli, clamped at 0. This is robust to modules shared between core and a feature (they appear in both bundles and cancel), unlike `total − core.total`.
- **History granularity:** one row per `main` commit (the `[skip ci]` size commit itself does not produce a row, since it does not re-run CI). Backfill from `git log -p --follow client-size-report.json` is possible if a denser history is ever wanted.
