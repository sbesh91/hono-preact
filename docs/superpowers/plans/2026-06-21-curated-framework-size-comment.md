# Curated framework-size PR comment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace compressed-size-action with a curated sticky PR comment that reports framework runtime per feature and per UI component (grouped, marginal-over-core, with a Δ column), using a build-both-refs delta so there is no committed baseline.

**Architecture:** Two small Node scripts, recovered and trimmed from the deleted `measure-client-size.mjs` (Sections A & C) and `render-size-comment.mjs`. A rewritten PR-only CI job builds the framework on the PR head and on the base ref (in a `git worktree`), measures each with the HEAD measure script, diffs, and posts the comment. The probe-file emitter and the action are removed; the `size-probe-config.mjs` manifests are reused.

**Tech Stack:** Node ESM scripts, esbuild (already a dependency), `node:zlib` gzip, vitest, GitHub Actions, pnpm, `marocchino/sticky-pull-request-comment`.

## Global Constraints

- **No em-dashes** in prose, code comments, or commit messages. Use commas, semicolons, colons, parentheses, or two sentences.
- **gzip only** (no brotli). The displayed number is gzip bytes.
- **Reuse `scripts/size-probe-config.mjs`** (the `CORE_MODULES` / `FEATURE_MODULES` / `EXTERNAL` / `UI_CORE_MODULES` / `COMPONENT_MODULES` manifests) as the single source of which modules form each row. Do not re-declare them.
- **No committed baseline and no history file.** The standing deletions of `client-size-report.json`, `client-size-history.jsonl`, `measure-client-size.mjs`, `render-size-comment.mjs`, `client-size-config.mjs` all remain.
- **Marginal semantics:** `core` and `ui-core` rows show their own gzip total; every other feature/component shows `marginal = max(0, gzip(base+entry) - gzip(base))`.
- GitHub Action pins use the major tag (`@v4`, `@v2`).
- This work reworks PR #149 on the existing branch `worktree-oss-bundle-size`; do not open a new PR. Old code to recover from lives at git ref `2587733` (e.g. `git show 2587733:scripts/measure-client-size.mjs`).
- Pre-push: mirror the CI steps in `CLAUDE.md`; `pnpm format:check` is the most-forgotten one. `pnpm test:coverage` must stay green at every task boundary.

## File Structure

**Created:**
- `scripts/measure-framework-size.mjs` — in-memory gzip measurement of Sections A & C, with `--iso-dist`/`--ui-dist` args so it can measure any ref's build.
- `scripts/__tests__/measure-framework-size.test.mjs`
- `scripts/render-framework-size-comment.mjs` — pure renderer for the two grouped tables.
- `scripts/__tests__/render-framework-size-comment.test.mjs`

**Deleted:**
- `scripts/emit-size-probes.mjs`, `scripts/__tests__/emit-size-probes.test.mjs` (the probe-file approach is obsolete once measurement is in-memory again).

**Modified:**
- `package.json` — revert the `build` script to framework + site only (drop the probe-emit append).
- `.github/workflows/ci.yml` — rewrite the `client-size` job to build-both + measure + render + sticky comment.
- `CLAUDE.md` — describe the build-both curated comment.

**Kept unchanged:** `scripts/size-probe-config.mjs`.

**Dependency ordering:** Task 4 (CI) consumes Task 1 (measure) and Task 2 (render). Task 3 deletes the emitter; after it, `size-probe-config.mjs` is still imported by Task 1's measure script, so nothing dangles. Every task boundary leaves `pnpm test:coverage` green.

---

### Task 1: measure-framework-size.mjs

**Files:**
- Create: `scripts/measure-framework-size.mjs`
- Test: `scripts/__tests__/measure-framework-size.test.mjs`

**Interfaces:**
- Consumes: `CORE_MODULES`, `FEATURE_MODULES`, `EXTERNAL`, `UI_CORE_MODULES`, `COMPONENT_MODULES` from `./size-probe-config.mjs`.
- Produces: `bundleSize(entryContents: string, resolveDir: string): Promise<number>` (gzip bytes); `measureSectionA(isoDist: string): Promise<Record<string,{total:number,marginal:number}>>`; `measureSectionC(uiDist: string): Promise<Record<string,{total:number,marginal:number}>>`; `buildReport({isoDist,uiDist}): Promise<{sectionA,sectionC}>`. CLI: `node scripts/measure-framework-size.mjs [--iso-dist <dir>] [--ui-dist <dir>] [--out <file>]`. Report shape: `{ sectionA: { core:{total,marginal}, <feature>:{total,marginal} }, sectionC: { 'ui-core':{total,marginal}, <component>:{total,marginal} } }` (gzip bytes). `core.marginal===core.total`, `ui-core.marginal===ui-core.total`.

**Prerequisite for the test:** `packages/iso/dist` and `packages/ui/dist` must be built (CI builds the framework before the `test` job; locally run `pnpm build` first).

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/measure-framework-size.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import {
  bundleSize,
  measureSectionA,
  measureSectionC,
} from '../measure-framework-size.mjs';
import { resolve } from 'node:path';

const ISO = resolve('packages/iso/dist');
const UI = resolve('packages/ui/dist');

describe('bundleSize', () => {
  it('returns positive gzip for a real iso module', async () => {
    const entry = `export * as m from '${resolve('packages/iso/dist/is-browser.js')}';`;
    expect(await bundleSize(entry, process.cwd())).toBeGreaterThan(0);
  });

  it('excludes peers (external) so a preact-only entry is a tiny shim', async () => {
    expect(await bundleSize(`export * as h from 'preact';`, process.cwd())).toBeLessThan(200);
  });
});

describe('measureSectionA', () => {
  it('returns core plus every feature with non-negative marginal', async () => {
    const a = await measureSectionA(ISO);
    expect(a.core.total).toBeGreaterThan(0);
    expect(a.core.marginal).toBe(a.core.total);
    for (const bucket of ['loaders', 'actions', 'transitions', 'prefetch', 'streaming', 'head', 'middleware']) {
      expect(a[bucket].total).toBeGreaterThan(0);
      expect(a[bucket].marginal).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('measureSectionC', () => {
  it('returns ui-core plus components with non-negative marginal', async () => {
    const c = await measureSectionC(UI);
    expect(c['ui-core'].total).toBeGreaterThan(0);
    expect(c.dialog.total).toBeGreaterThan(0);
    expect(c.dialog.marginal).toBeGreaterThanOrEqual(0);
  });

  it('returns {} when the ui dist is absent', async () => {
    expect(await measureSectionC(resolve('packages/ui/does-not-exist'))).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/__tests__/measure-framework-size.test.mjs`
Expected: FAIL, cannot resolve `../measure-framework-size.mjs`.

- [ ] **Step 3: Create the measure script**

Create `scripts/measure-framework-size.mjs`:

```js
#!/usr/bin/env node
// Measures framework client-JS size for the PR comment: Section A (framework
// runtime per feature) and Section C (per UI component), as isolated esbuild
// bundles with peers external, sized with gzip. Marginal cost is over the
// `core` / `ui-core` base bundle. No site-chunk bucketing, no brotli, no
// committed baseline: the CI job builds both refs and diffs live.
//
// Usage:
//   node scripts/measure-framework-size.mjs                       # local dist -> stdout
//   node scripts/measure-framework-size.mjs --out FILE
//   node scripts/measure-framework-size.mjs --iso-dist DIR --ui-dist DIR --out FILE
// The --iso-dist / --ui-dist args let this HEAD script measure another ref's
// build (e.g. a base-branch worktree) so deltas need no committed baseline.

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_MODULES,
  FEATURE_MODULES,
  EXTERNAL,
  UI_CORE_MODULES,
  COMPONENT_MODULES,
} from './size-probe-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Bundle an entry source string in isolation and return its gzip size in bytes.
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
  return gzipSync(Buffer.from(result.outputFiles[0].contents)).length;
}

// Re-export each dist module by namespace so sideEffects:false tree-shaking
// cannot drop a side-effect-free import. `distBase` is an absolute path, so the
// entry can point at any ref's build.
function entryFor(modules, distBase) {
  return modules
    .map((m, i) => `export * as m${i} from '${join(distBase, m)}';`)
    .join('\n');
}

// Section A: core total, then each feature's total (isolated) and marginal cost
// over core (= gzip(core+feature) - gzip(core), clamped at 0).
export async function measureSectionA(isoDist) {
  const core = await bundleSize(entryFor(CORE_MODULES, isoDist), ROOT);
  const sectionA = { core: { total: core, marginal: core } };
  for (const [bucket, modules] of Object.entries(FEATURE_MODULES)) {
    const total = await bundleSize(entryFor(modules, isoDist), ROOT);
    const combined = await bundleSize(entryFor([...CORE_MODULES, ...modules], isoDist), ROOT);
    sectionA[bucket] = { total, marginal: Math.max(0, combined - core) };
  }
  return sectionA;
}

// Section C: ui-core total, then each component's total and marginal over
// ui-core. Returns {} when the ui dist is absent so a partial build never crashes.
export async function measureSectionC(uiDist) {
  if (!existsSync(uiDist)) return {};
  const uiCore = await bundleSize(entryFor(UI_CORE_MODULES, uiDist), ROOT);
  const sectionC = { 'ui-core': { total: uiCore, marginal: uiCore } };
  for (const [name, modules] of Object.entries(COMPONENT_MODULES)) {
    const total = await bundleSize(entryFor(modules, uiDist), ROOT);
    const combined = await bundleSize(entryFor([...UI_CORE_MODULES, ...modules], uiDist), ROOT);
    sectionC[name] = { total, marginal: Math.max(0, combined - uiCore) };
  }
  return sectionC;
}

export async function buildReport({ isoDist, uiDist }) {
  return {
    sectionA: await measureSectionA(isoDist),
    sectionC: await measureSectionC(uiDist),
  };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? undefined : v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const isoDist = resolve(arg('iso-dist') ?? join(ROOT, 'packages/iso/dist'));
  const uiDist = resolve(arg('ui-dist') ?? join(ROOT, 'packages/ui/dist'));
  const report = await buildReport({ isoDist, uiDist });
  const json = JSON.stringify(report, null, 2) + '\n';
  const out = arg('out');
  if (out) {
    writeFileSync(out, json);
    console.log(`Wrote ${out}`);
  } else {
    process.stdout.write(json);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Ensure dist exists once: `pnpm build`
Run: `pnpm exec vitest run scripts/__tests__/measure-framework-size.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/measure-framework-size.mjs scripts/__tests__/measure-framework-size.test.mjs
git commit -m "feat(size): in-memory framework size measure (sections A and C)"
```

---

### Task 2: render-framework-size-comment.mjs

**Files:**
- Create: `scripts/render-framework-size-comment.mjs`
- Test: `scripts/__tests__/render-framework-size-comment.test.mjs`

**Interfaces:**
- Consumes: report objects of the shape Task 1 produces (`{sectionA,sectionC}` with `{total,marginal}` gzip bytes per row).
- Produces: `renderComment(fresh, base, meta?): string`. CLI: `node scripts/render-framework-size-comment.mjs <fresh.json> <base.json>` prints markdown. Sticky-comment header marker `<!-- framework-size -->`.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/render-framework-size-comment.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { renderComment } from '../render-framework-size-comment.mjs';

const base = {
  sectionA: {
    core: { total: 4000, marginal: 4000 },
    loaders: { total: 5000, marginal: 1000 },
  },
  sectionC: {
    'ui-core': { total: 1400, marginal: 1400 },
    dialog: { total: 2000, marginal: 600 },
  },
};

describe('renderComment', () => {
  it('shows core total and feature marginal with unchanged delta', () => {
    const md = renderComment(base, base);
    expect(md).toContain('<!-- framework-size -->');
    expect(md).toContain('## Framework JS size');
    expect(md).toContain('### Framework runtime (gzip)');
    expect(md).toContain('| core | 4.0 KB | — |');
    expect(md).toContain('| loaders | 1.0 KB | — |');
    expect(md).toContain('### Components (gzip)');
    expect(md).toContain('| ui-core | 1.4 KB | — |');
    expect(md).toContain('| dialog | 600 B | — |');
  });

  it('renders increase, new, decrease and removed', () => {
    const fresh = {
      sectionA: {
        core: { total: 4000, marginal: 4000 },
        loaders: { total: 5200, marginal: 1200 },
        actions: { total: 4300, marginal: 300 },
      },
      sectionC: { 'ui-core': { total: 1300, marginal: 1300 } },
    };
    const md = renderComment(fresh, base);
    expect(md).toContain('| loaders | 1.2 KB | +200 B |');
    expect(md).toContain('| actions | 300 B | (new) |');
    expect(md).toContain('| ui-core | 1.3 KB | -100 B |');
    expect(md).toContain('| dialog | (removed) | |');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/__tests__/render-framework-size-comment.test.mjs`
Expected: FAIL, cannot resolve `../render-framework-size-comment.mjs`.

- [ ] **Step 3: Create the renderer**

Create `scripts/render-framework-size-comment.mjs`:

```js
#!/usr/bin/env node
// Pure renderer: turns (freshReport, baseReport) into the framework-size sticky
// PR comment markdown. CLI form reads two JSON files and prints the markdown.

import { readFileSync } from 'node:fs';

const COMMENT_HEADER = '<!-- framework-size -->';

// 1000-based KB with one decimal (15000 -> "15.0 KB"); raw bytes under 1000.
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

// The displayed gzip number: the base bundle (`core` / `ui-core`) shows its own
// total; every other row shows its marginal cost over the base bundle.
function shown(name, entry, baseName) {
  if (!entry) return undefined;
  return name === baseName ? entry.total : entry.marginal;
}

function row(name, fresh, base) {
  if (fresh === undefined) return `| ${name} | (removed) | |`;
  return `| ${name} | ${fmtBytes(fresh)} | ${fmtDelta(fresh, base)} |`;
}

function freshnessFooter(meta) {
  if (!meta) return undefined;
  const parts = [];
  if (meta.sha) parts.push(`\`${meta.sha.slice(0, 9)}\``);
  if (meta.generatedAt) parts.push(meta.generatedAt);
  if (meta.runUrl) parts.push(`[run](${meta.runUrl})`);
  return parts.length ? `<sub>Measured ${parts.join(' · ')}</sub>` : undefined;
}

function section(lines, title, sub, columnLabel, freshObj, baseObj, baseName) {
  lines.push(`### ${title}`);
  lines.push(`<sub>${sub}</sub>`);
  lines.push(`| ${columnLabel} | Size | Δ vs base |`);
  lines.push('|---|---|---|');
  const names = new Set([...Object.keys(freshObj), ...Object.keys(baseObj)]);
  for (const name of names) {
    lines.push(
      row(name, shown(name, freshObj[name], baseName), shown(name, baseObj[name], baseName))
    );
  }
  lines.push('');
}

export function renderComment(fresh, base, meta) {
  const lines = [COMMENT_HEADER, '## Framework JS size', ''];
  section(
    lines,
    'Framework runtime (gzip)',
    '`core` is the base bundle; each feature is the extra it adds on top of core.',
    'Feature',
    fresh.sectionA,
    base.sectionA,
    'core'
  );
  section(
    lines,
    'Components (gzip)',
    '`ui-core` is the shared primitives; each component is the extra it adds on top.',
    'Component',
    fresh.sectionC ?? {},
    base.sectionC ?? {},
    'ui-core'
  );
  const footer = freshnessFooter(meta);
  if (footer) lines.push(footer);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [freshPath, basePath] = process.argv.slice(2);
  if (!freshPath || !basePath) {
    console.error('Usage: render-framework-size-comment.mjs <fresh.json> <base.json>');
    process.exit(1);
  }
  const fresh = JSON.parse(readFileSync(freshPath, 'utf8'));
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  const meta = {
    sha: process.env.SIZE_COMMENT_SHA,
    runUrl: process.env.SIZE_COMMENT_RUN_URL,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  process.stdout.write(renderComment(fresh, base, meta) + '\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run scripts/__tests__/render-framework-size-comment.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/render-framework-size-comment.mjs scripts/__tests__/render-framework-size-comment.test.mjs
git commit -m "feat(size): curated framework-size comment renderer"
```

---

### Task 3: Remove the obsolete probe-file emitter

**Files:**
- Delete: `scripts/emit-size-probes.mjs`, `scripts/__tests__/emit-size-probes.test.mjs`
- Modify: `package.json` (the `build` script)

**Interfaces:**
- Consumes: nothing. After this task, `scripts/size-probe-config.mjs` is imported only by `scripts/measure-framework-size.mjs` (Task 1).
- Produces: a `build` script that is framework + site only (matches `main`).

- [ ] **Step 1: Delete the emitter and its test**

```bash
git rm scripts/emit-size-probes.mjs scripts/__tests__/emit-size-probes.test.mjs
```

- [ ] **Step 2: Revert the `build` script**

In `package.json`, change the `"build"` line back to framework + site only (drop the probe-emit append):

```json
    "build": "pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm --filter site build",
```

- [ ] **Step 3: Verify no dangling references and the suite is green**

Run: `rg -n "emit-size-probes|size:build" scripts/ package.json .github/workflows/ci.yml`
Expected: the only matches are in `.github/workflows/ci.yml` (the old `compressed-size-action` job, replaced in Task 4); nothing under `scripts/` or in `package.json`.
Run: `pnpm exec vitest run scripts/__tests__/`
Expected: PASS (the two new size tests plus the lighthouse tests; no emit test remains).

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/emit-size-probes.mjs scripts/__tests__/emit-size-probes.test.mjs
git commit -m "chore(size): drop the obsolete probe-file emitter; build stays pure"
```

---

### Task 4: Build-both CI job and docs

**Files:**
- Modify: `.github/workflows/ci.yml` (replace the entire `client-size` job)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `scripts/measure-framework-size.mjs` (Task 1), `scripts/render-framework-size-comment.mjs` (Task 2).
- Produces: a PR-only `client-size` job that builds the framework on head and base, measures both, diffs, and posts the `framework-size` sticky comment.

- [ ] **Step 1: Replace the `client-size` job**

In `.github/workflows/ci.yml`, replace the entire `client-size:` job (currently the `compressed-size-action` one) with:

```yaml
  client-size:
    name: Framework JS size
    needs: test
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      # Version derives from the `packageManager` field in package.json.
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build framework (PR head)
        run: pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build

      - name: Measure PR head
        run: node scripts/measure-framework-size.mjs --out /tmp/head.json

      # Build-both delta: measure the base ref in a worktree using THIS head's
      # measure script (so the base never needs to carry the script), then diff.
      # No committed baseline, so no metrics-commit merge conflicts.
      - name: Build framework (base ref) and measure
        env:
          BASE: ${{ github.event.pull_request.base.ref }}
        run: |
          git fetch --no-tags --depth=1 origin "$BASE"
          git worktree add /tmp/base "origin/$BASE"
          (cd /tmp/base && pnpm install --frozen-lockfile && pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build)
          node scripts/measure-framework-size.mjs \
            --iso-dist /tmp/base/packages/iso/dist \
            --ui-dist /tmp/base/packages/ui/dist \
            --out /tmp/base.json

      - name: Render comment
        env:
          SIZE_COMMENT_SHA: ${{ github.event.pull_request.head.sha }}
          SIZE_COMMENT_RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: node scripts/render-framework-size-comment.mjs /tmp/head.json /tmp/base.json > /tmp/comment.md

      - name: Post sticky comment
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: framework-size
          path: /tmp/comment.md
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); puts 'yaml ok'"`
Expected: `yaml ok`. Then confirm the action is gone: `rg -n "compressed-size-action|strip-hash|size-probes|build-script" .github/workflows/ci.yml` should print nothing.

- [ ] **Step 3: Local smoke test of measure + render**

Build once, measure head, and render head-vs-itself (every Δ should be `—`, proving the wiring):

```bash
pnpm build
node scripts/measure-framework-size.mjs --out /tmp/head.json
node scripts/render-framework-size-comment.mjs /tmp/head.json /tmp/head.json
```
Expected: markdown with `## Framework JS size`, a `### Framework runtime (gzip)` table containing a `core` row and feature rows, a `### Components (gzip)` table with `ui-core` and component rows, and every `Δ vs base` cell showing `—`.

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`, find the sentence added for compressed-size-action (it starts "Client JS size is tracked separately by the PR-only `client-size` job, which runs `preactjs/compressed-size-action`...") and replace it with:

```
Client JS size (framework runtime per feature plus UI components) is tracked by the PR-only `client-size` job. It builds the framework on the PR head and on the base ref (in a `git worktree`), measures each with `scripts/measure-framework-size.mjs` (isolated esbuild bundles, peers external, gzip, marginal over core / ui-core), and posts a curated sticky comment via `scripts/render-framework-size-comment.mjs`. There is no committed size baseline: the job diffs head versus base live, so nothing is committed on `main`.
```

Then run `rg -n "compressed-size-action|emit-size-probes|size:build" CLAUDE.md` and fix any other stale mention the same way.

- [ ] **Step 5: Run the pre-push CI mirror**

Run, in order:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all pass. (If `format:check` fails, run `pnpm format`, re-stage, and re-run.)

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml CLAUDE.md
git commit -m "ci(size): build-both framework-size comment; drop compressed-size-action"
```

---

## Self-Review

- **Spec coverage:** measure A/C (Task 1), curated renderer (Task 2), drop probe-file emitter + revert build (Task 3), build-both CI job + CLAUDE.md (Task 4), reuse `size-probe-config.mjs` (Task 1 import), no committed baseline / standing deletions kept (Global Constraints + Task 3), gzip-only + marginal semantics (Task 1/2), sticky `framework-size` header (Task 2/4), tests (Task 1/2 + Task 4 smoke + Step 5 mirror). All spec sections covered.
- **Placeholder scan:** no TBD/TODO; every code step is complete; the CLAUDE.md edit names the exact replacement text.
- **Type/name consistency:** report shape `{sectionA,sectionC}` with `{total,marginal}` is produced by Task 1 and consumed by Task 2's `renderComment` and the renderer test; `measureSectionA/C`, `buildReport`, `bundleSize`, `renderComment` names match across tasks and the CI job; the CI job calls the exact CLI flags (`--iso-dist`/`--ui-dist`/`--out`) Task 1 defines.
