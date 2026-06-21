# OSS Bundle Size Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the home-rolled client-size reporting machinery with `preactjs/compressed-size-action`, keeping the bespoke per-feature/per-component framework measurement as on-disk "size probes" the action measures and diffs for us.

**Architecture:** The current system has three home-rolled pieces: a measure script (Sections A/B/C), a markdown comment renderer, and a committed baseline + history that CI updates on every `main` push. We replace the comment/baseline/history plumbing with `compressed-size-action`, which builds the PR head and the base ref, gzips matching files, and posts a sticky comparison comment with no committed state. Section B (site chunks) is just the emitted JS, which the action globs directly. Sections A and C (synthetic per-feature/per-component bundles) are not files on disk, so we keep a slimmed script that emits each isolated bundle as a real `.js` file under a gitignored, non-deployed probe directory; the action then gzips and diffs those probes alongside the real chunks.

**Tech Stack:** Node ESM scripts, esbuild (already a dependency), vitest, GitHub Actions, pnpm.

## Global Constraints

- **No em-dashes** in prose, code comments, or commit messages (user global rule). Use commas, semicolons, colons, parentheses, or two sentences.
- **No inline type casts**; reshape instead. (These are plain `.mjs` files, so this rarely applies, but holds for any TS touched.)
- **Modularity over brevity**: single-responsibility files; do not code-golf.
- Probe output goes under `apps/site/dist/size-probes/`, which is already gitignored (root `.gitignore` line 19: `dist`) and is NOT in the deployed assets directory (`apps/site/wrangler.jsonc` sets `assets.directory: "../client"`, i.e. only `apps/site/dist/client` ships).
- Pre-push: mirror the 7 CI steps in project `CLAUDE.md` before pushing; `pnpm format:check` is the one most often forgotten. `pnpm test:coverage` must stay green at every task boundary.
- GitHub Action pins use the major tag (`@v4`, `@v2`) to match repo convention.

## File Structure

**Created:**
- `scripts/size-probe-config.mjs` — module manifests only (which dist modules form each probe). Trimmed copy of the kept half of `client-size-config.mjs`.
- `scripts/emit-size-probes.mjs` — emits one minified isolated bundle per probe. Repurposed from `measure-client-size.mjs`.
- `scripts/__tests__/size-probe-config.test.mjs` — manifest sanity.
- `scripts/__tests__/emit-size-probes.test.mjs` — emitter behavior.

**Deleted:**
- `scripts/measure-client-size.mjs`, `scripts/__tests__/measure-client-size.test.mjs`
- `scripts/render-size-comment.mjs`, `scripts/__tests__/render-size-comment.test.mjs`
- `scripts/client-size-config.mjs`, `scripts/__tests__/client-size-config.test.mjs`
- `client-size-report.json`, `client-size-history.jsonl` (committed baseline + history)

**Modified:**
- `package.json` (root) — add a `size:build` script.
- `.github/workflows/ci.yml` — swap the PR `client-size` job to the action; strip size baseline from the `main` job.
- `CLAUDE.md` (project) — update the client-size description.
- `scripts/measure-lighthouse.mjs`, `scripts/render-lighthouse-comment.mjs` — fix two comments that name the deleted files.

**Dependency ordering note (why deletions are staged):** `client-size-config.mjs` is imported by both `measure-client-size.mjs` and `render-size-comment.mjs`. It is therefore deleted only in Task 4, after both consumers are gone. Every intermediate task state has no dangling imports, so `pnpm test:coverage` stays green throughout.

---

### Task 1: Trimmed probe config

**Files:**
- Create: `scripts/size-probe-config.mjs`
- Test: `scripts/__tests__/size-probe-config.test.mjs`

**Interfaces:**
- Produces: `CORE_MODULES: string[]`, `FEATURE_MODULES: Record<string, string[]>`, `EXTERNAL: string[]`, `UI_CORE_MODULES: string[]`, `COMPONENT_MODULES: Record<string, string[]>`. (No `CHUNK_PREFIXES`, `bucketForChunk`, `tableGzip`, or `componentTableGzip`; those belonged to the deleted report/bucketing path.)

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/size-probe-config.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import {
  CORE_MODULES,
  FEATURE_MODULES,
  UI_CORE_MODULES,
  COMPONENT_MODULES,
  EXTERNAL,
} from '../size-probe-config.mjs';

describe('size-probe-config manifests', () => {
  it('declares non-empty core and feature module lists', () => {
    expect(CORE_MODULES.length).toBeGreaterThan(0);
    expect(Object.keys(FEATURE_MODULES)).toContain('loaders');
    expect(FEATURE_MODULES.loaders.length).toBeGreaterThan(0);
    expect(Object.keys(FEATURE_MODULES)).toContain('middleware');
  });

  it('declares ui-core and component module lists', () => {
    expect(UI_CORE_MODULES.length).toBeGreaterThan(0);
    expect(COMPONENT_MODULES.dialog).toEqual(['dialog/index.js']);
    expect(COMPONENT_MODULES.popover).toEqual(['popover/index.js']);
  });

  it('lists preact and hono as external peers', () => {
    expect(EXTERNAL).toContain('preact');
    expect(EXTERNAL).toContain('hono');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/__tests__/size-probe-config.test.mjs`
Expected: FAIL, cannot resolve `../size-probe-config.mjs`.

- [ ] **Step 3: Create the trimmed config**

Create `scripts/size-probe-config.mjs`:

```js
// Module manifests that define each size probe. The emitter
// (emit-size-probes.mjs) bundles each entry in isolation so
// compressed-size-action can gzip and diff it per PR. Peers in EXTERNAL are
// excluded so a probe reflects only the framework's own code on top of a
// runtime the consumer already ships.

// Framework base. Every feature probe is measured on its own; subtract the
// `core` probe in the PR comment to read a feature's marginal cost.
export const CORE_MODULES = [
  'define-app.js',
  'define-routes.js',
  'define-page.js',
  'page.js',
  'client-script.js',
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
  ],
  prefetch: ['prefetch.js'],
  streaming: ['define-stream-observer.js'],
  head: ['head.js'],
  middleware: ['define-middleware.js', 'reload-context.js'],
};

// Peers a consumer already has; excluded so a probe measures only the
// framework's own bytes on top of preact. Anything NOT listed here (e.g. a
// third-party dep a feature drags in) is intentionally counted.
export const EXTERNAL = [
  'preact',
  'preact/*',
  'preact-iso',
  'preact-iso/*',
  'hono',
  'hono/*',
];

// Per-component cost from packages/ui/dist. The shared primitives form the
// `core` ui probe; each component lists the dist module(s) its public entry
// pulls in.
export const UI_CORE_MODULES = [
  'render-element.js',
  'merge-refs.js',
  'use-controllable-state.js',
  'use-presence.js',
];

export const COMPONENT_MODULES = {
  dialog: ['dialog/index.js'],
  popover: ['popover/index.js'],
  tooltip: ['tooltip/index.js'],
  menu: ['menu/index.js'],
  'context-menu': ['context-menu/index.js'],
  select: ['select/index.js'],
  combobox: ['combobox/index.js'],
  toast: ['toast/index.js'],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run scripts/__tests__/size-probe-config.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/size-probe-config.mjs scripts/__tests__/size-probe-config.test.mjs
git commit -m "feat(size): add trimmed size-probe module manifests"
```

---

### Task 2: Probe emitter

**Files:**
- Create: `scripts/emit-size-probes.mjs`
- Test: `scripts/__tests__/emit-size-probes.test.mjs`
- Delete: `scripts/measure-client-size.mjs`, `scripts/__tests__/measure-client-size.test.mjs`

**Interfaces:**
- Consumes: `CORE_MODULES`, `FEATURE_MODULES`, `EXTERNAL`, `UI_CORE_MODULES`, `COMPONENT_MODULES` from `./size-probe-config.mjs` (Task 1).
- Produces: `emitProbe(entryContents: string, outPath: string): Promise<void>` and `emitAllProbes(outDir: string): Promise<string[]>` (returns written paths). CLI: `node scripts/emit-size-probes.mjs [--out <dir>]`, default out `apps/site/dist/size-probes`. Writes `<out>/framework/<core|feature>.js` and `<out>/ui/<core|component>.js`.

**Prerequisite for the test:** `packages/iso/dist` and `packages/ui/dist` must be built. CI builds the framework before the `test` job; locally run `pnpm build` (or at least the framework filter) first. This matches the old `measure-client-size.test.mjs`, which also required built dist.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/emit-size-probes.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { emitProbe, emitAllProbes } from '../emit-size-probes.mjs';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('emitProbe', () => {
  it('writes a non-empty minified bundle for a real iso module', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const out = join(dir, 'core.js');
    await emitProbe(
      `export * as m from './packages/iso/dist/is-browser.js';`,
      out
    );
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it('excludes peers (external) so a preact-only entry is a tiny shim', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const out = join(dir, 'peer.js');
    await emitProbe(`export * as h from 'preact';`, out);
    // preact is external, so the bundle is just a re-export shim.
    expect(statSync(out).size).toBeLessThan(200);
  });
});

describe('emitAllProbes', () => {
  it('emits a framework probe per core+feature entry and a ui probe per component', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probes-'));
    const written = await emitAllProbes(dir);
    expect(existsSync(join(dir, 'framework', 'core.js'))).toBe(true);
    expect(existsSync(join(dir, 'framework', 'loaders.js'))).toBe(true);
    expect(existsSync(join(dir, 'framework', 'actions.js'))).toBe(true);
    // packages/ui/dist is built in CI before tests, so ui probes are emitted.
    expect(existsSync(join(dir, 'ui', 'core.js'))).toBe(true);
    expect(existsSync(join(dir, 'ui', 'dialog.js'))).toBe(true);
    expect(written.length).toBeGreaterThan(10);
    for (const p of written) expect(statSync(p).size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/__tests__/emit-size-probes.test.mjs`
Expected: FAIL, cannot resolve `../emit-size-probes.mjs`.

- [ ] **Step 3: Create the emitter**

Create `scripts/emit-size-probes.mjs`:

```js
#!/usr/bin/env node
// Emits one minified, isolated bundle per size probe so compressed-size-action
// can gzip and diff each on every PR. Framework probes come from
// packages/iso/dist, component probes from packages/ui/dist; EXTERNAL peers are
// excluded. Output layout:
//   <out>/framework/<core|feature>.js
//   <out>/ui/<core|component>.js
// Default <out> is apps/site/dist/size-probes (gitignored, not deployed).
//
// Usage: node scripts/emit-size-probes.mjs [--out <dir>]

import { build } from 'esbuild';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_MODULES,
  FEATURE_MODULES,
  EXTERNAL,
  UI_CORE_MODULES,
  COMPONENT_MODULES,
} from './size-probe-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Re-export each dist module by namespace so sideEffects:false tree-shaking
// cannot drop a side-effect-free import (entry-point exports are always kept).
function entryFor(modules, distBase) {
  return modules
    .map((m, i) => `export * as m${i} from './${distBase}/${m}';`)
    .join('\n');
}

// Bundle one probe entry in isolation and write the minified output to outPath.
export async function emitProbe(entryContents, outPath) {
  const result = await build({
    stdin: { contents: entryContents, resolveDir: ROOT, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    external: EXTERNAL,
    legalComments: 'none',
    logLevel: 'silent',
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.outputFiles[0].contents);
}

// Emit every probe under `outDir`. Returns the written paths. Skips the ui
// probes when packages/ui/dist is absent so a partial build never crashes.
export async function emitAllProbes(outDir) {
  const written = [];

  const frameworkProbes = { core: CORE_MODULES, ...FEATURE_MODULES };
  for (const [name, modules] of Object.entries(frameworkProbes)) {
    const outPath = join(outDir, 'framework', `${name}.js`);
    await emitProbe(entryFor(modules, 'packages/iso/dist'), outPath);
    written.push(outPath);
  }

  const uiBase = 'packages/ui/dist';
  if (existsSync(join(ROOT, uiBase))) {
    const uiProbes = { core: UI_CORE_MODULES, ...COMPONENT_MODULES };
    for (const [name, modules] of Object.entries(uiProbes)) {
      const outPath = join(outDir, 'ui', `${name}.js`);
      await emitProbe(entryFor(modules, uiBase), outPath);
      written.push(outPath);
    }
  }

  return written;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? undefined : v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = arg('out') ?? join(ROOT, 'apps/site/dist/size-probes');
  const written = await emitAllProbes(outDir);
  console.log(`Emitted ${written.length} size probe(s) under ${outDir}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

First ensure dist exists (once): `pnpm build`
Then run: `pnpm exec vitest run scripts/__tests__/emit-size-probes.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Delete the old measure script and its test**

```bash
git rm scripts/measure-client-size.mjs scripts/__tests__/measure-client-size.test.mjs
```

- [ ] **Step 6: Verify the wider suite still passes**

Run: `pnpm exec vitest run scripts/__tests__/`
Expected: PASS. `render-size-comment.test.mjs` and `client-size-config.test.mjs` still pass (their imports, `render-size-comment.mjs` and `client-size-config.mjs`, still exist; deleted in Tasks 4 and 4 respectively).

- [ ] **Step 7: Commit**

```bash
git add scripts/emit-size-probes.mjs scripts/__tests__/emit-size-probes.test.mjs
git commit -m "feat(size): emit per-feature size probes; drop measure-client-size"
```

---

### Task 3: Wire the build-script

**Files:**
- Modify: `package.json` (root, scripts block near `build`/`visualize`)

**Interfaces:**
- Consumes: `scripts/emit-size-probes.mjs` (Task 2), the existing root `build` script.
- Produces: `pnpm size:build` (= `pnpm build && node scripts/emit-size-probes.mjs`). This is the single npm script `compressed-size-action` runs for both the PR head and the base ref in Task 4.

- [ ] **Step 1: Add the script**

In root `package.json`, add this entry to `"scripts"` immediately after the `"build"` line:

```json
    "size:build": "pnpm build && node scripts/emit-size-probes.mjs",
```

- [ ] **Step 2: Verify it builds and emits probes**

Run: `pnpm size:build`
Expected: build completes, then `Emitted N size probe(s) under .../apps/site/dist/size-probes` where N is 16 (8 framework: core + 7 features; 8 ui: core + 7 components).

- [ ] **Step 3: Verify the action's glob will match both chunks and probes**

Run: `node -e "import('node:fs').then(({readdirSync})=>{const g=require('glob');})" 2>/dev/null; ls apps/site/dist/client/static/*.js | head -3; echo '---'; ls apps/site/dist/size-probes/framework/*.js apps/site/dist/size-probes/ui/*.js | head -5`
Expected: both listings are non-empty. (The action's `pattern: 'apps/site/dist/{client,size-probes}/**/*.js'` covers both trees.)

- [ ] **Step 4: Confirm probes are gitignored and not in the deployed assets dir**

Run: `git check-ignore apps/site/dist/size-probes/framework/core.js && grep -o '"directory":"[^"]*"' apps/site/dist/hono_preact/wrangler.json`
Expected: prints the ignored path, then `"directory":"../client"` (probes live in `dist/size-probes`, which is not `dist/client`, so they never ship).

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat(size): add size:build script that builds and emits probes"
```

---

### Task 4: Swap the PR job to compressed-size-action

**Files:**
- Modify: `.github/workflows/ci.yml` (the `client-size:` job, currently lines ~69-112)
- Delete: `scripts/render-size-comment.mjs`, `scripts/__tests__/render-size-comment.test.mjs`
- Delete: `scripts/client-size-config.mjs`, `scripts/__tests__/client-size-config.test.mjs`

**Interfaces:**
- Consumes: `size:build` (Task 3).
- Produces: a PR-only `client-size` job that runs `preactjs/compressed-size-action@v2`, building head and base via `size:build`, gzipping `apps/site/dist/{client,size-probes}/**/*.js`, and posting one sticky comparison comment.

- [ ] **Step 1: Replace the job body**

In `.github/workflows/ci.yml`, replace the entire `client-size:` job (from `  client-size:` through its last `path: /tmp/size-comment.md` step) with:

```yaml
  client-size:
    name: Client JS size
    needs: test
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      # pnpm and node must be on PATH; compressed-size-action runs install and
      # the build-script itself for both the PR head and the base ref, then
      # gzips the matches and posts a single sticky comparison comment.
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm

      - uses: preactjs/compressed-size-action@v2
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
          # `size:build` runs `pnpm build` then emits the framework/ui size
          # probes. The action gzips every match and diffs head vs base.
          build-script: size:build
          pattern: 'apps/site/dist/{client,size-probes}/**/*.js'
          compression: gzip
```

- [ ] **Step 2: Lint the workflow YAML**

Run: `node -e "const y=require('js-yaml'); y.load(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log('yaml ok')"`
Expected: `yaml ok`. (If `js-yaml` is not installed, instead run `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`.)

- [ ] **Step 3: Delete the renderer and the now-orphaned config (and their tests)**

`render-size-comment.mjs` was the only remaining importer of `client-size-config.mjs` besides the already-deleted measure script, so both can go now:

```bash
git rm scripts/render-size-comment.mjs scripts/__tests__/render-size-comment.test.mjs \
       scripts/client-size-config.mjs scripts/__tests__/client-size-config.test.mjs
```

- [ ] **Step 4: Verify no dangling imports and the suite is green**

Run: `rg -n "client-size-config|render-size-comment|measure-client-size" scripts/ ; pnpm exec vitest run scripts/__tests__/`
Expected: the `rg` prints nothing (no references left under `scripts/`), and vitest PASSES (only the two new size tests plus the lighthouse tests remain).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(size): track client size via compressed-size-action; drop renderer"
```

---

### Task 5: Strip the size baseline from the main job and fix references

**Files:**
- Modify: `.github/workflows/ci.yml` (the `main` push / `build-and-tag` job: the "Measure client size baseline" and "Commit baselines" steps, currently lines ~201-238)
- Delete: `client-size-report.json`, `client-size-history.jsonl`
- Modify: `CLAUDE.md` (project), `scripts/measure-lighthouse.mjs`, `scripts/render-lighthouse-comment.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: a `main` job that no longer measures or commits client-size baselines; the Lighthouse baseline commit is unchanged.

- [ ] **Step 1: Delete the "Measure client size baseline" step**

In `.github/workflows/ci.yml`, remove this entire step from the `main` job:

```yaml
      - name: Measure client size baseline
        run: |
          node scripts/measure-client-size.mjs \
            --append-history \
            --sha "$GITHUB_SHA" \
            --date "$(git show -s --format=%cI "$GITHUB_SHA")"
```

- [ ] **Step 2: Trim the "Commit baselines" step to Lighthouse only**

Replace the `Commit baselines` step with:

```yaml
      - name: Commit baselines
        run: |
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git config user.name "github-actions[bot]"
          if ! git diff --quiet lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json; then
            git add lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
            git commit -m "chore(metrics): update lighthouse baselines [skip ci]"
            git push origin HEAD:main
          fi
```

- [ ] **Step 3: Delete the committed baseline and history**

```bash
git rm client-size-report.json client-size-history.jsonl
```

- [ ] **Step 4: Update the project CLAUDE.md**

In `CLAUDE.md`, find the Lighthouse paragraph sentence that reads (approximately):

> the `main` push job commits the `lighthouse-report.json` / `lighthouse-history.jsonl` / `lighthouse-badge.json` baselines alongside the client-size ones.

Replace `alongside the client-size ones.` so the sentence ends at `baselines.` and add a following sentence:

```
Client JS size is tracked separately by the PR-only `client-size` job, which runs `preactjs/compressed-size-action` to gzip the emitted site chunks plus the framework/UI size probes (`scripts/emit-size-probes.mjs`, written to `apps/site/dist/size-probes/`) and diff them against the base branch. There is no committed size baseline.
```

Then run `rg -n "client-size" CLAUDE.md` and fix any other stale mention the same way.

- [ ] **Step 5: Fix the two dangling comments in the Lighthouse scripts**

In `scripts/measure-lighthouse.mjs`, the header comment names `measure-client-size.mjs`. Reword that line so it no longer references the deleted file, for example change `Mirrors measure-client-size.mjs:` to `Writes the committed Lighthouse report/history/badge files.` (keep the surrounding sentence coherent).

In `scripts/render-lighthouse-comment.mjs`, change the line `// Mirrors render-size-comment.mjs.` to `// Pure renderer: turns (fresh, baseline) reports into the sticky PR comment markdown.`

- [ ] **Step 6: Verify nothing live still references the removed files**

Run: `rg -n "measure-client-size|render-size-comment|client-size-config|client-size-report|client-size-history" --glob '!docs/superpowers/**'`
Expected: no matches. (Historical plan/spec docs under `docs/superpowers/` are left as-is per the "docs don't talk about historical changes" convention; they describe the system at the time they were written.)

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml CLAUDE.md scripts/measure-lighthouse.mjs scripts/render-lighthouse-comment.mjs
git commit -m "ci(size): drop committed size baseline from main; fix stale references"
```

---

## Final verification (before opening a PR)

Run the CI mirror from project `CLAUDE.md`, in order. The size change touches steps 1, 2, and 5:

- [ ] `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build` (framework dist current)
- [ ] `pnpm format:check` (the most-forgotten gate; run `pnpm format` then re-stage if it fails)
- [ ] `pnpm typecheck`
- [ ] `pnpm test:types`
- [ ] `pnpm test:coverage` (confirms the two new size tests pass and nothing imports the deleted modules)
- [ ] `pnpm test:integration`
- [ ] `pnpm --filter site build`
- [ ] `pnpm size:build` one final time; confirm `Emitted 16 size probe(s)`.

## Rollout note (expected one-time effect)

On the PR that introduces this change, the base ref (`main`) does not yet contain `size:build` or `emit-size-probes.mjs`. `compressed-size-action` builds the base with `build-script: size:build`; on that first PR the base build of `size:build` will fail or produce no probes, so the comment may show the probe files as newly added rather than as deltas. This is a one-time artifact: once merged, `main` carries the script and subsequent PRs diff cleanly. No action needed beyond awareness; do not interpret the first PR's "all new" probe rows as a regression.

## Self-Review

- **Spec coverage:** Decision to adopt OSS + maintained tool (compressed-size-action, actively released v2.10.0 June 2026) — Tasks 4/5. Keep Section A/C as probes — Tasks 1/2/3. Delete renderer/baseline/history/bucketing — Tasks 2/4/5. Site bundle (Section B) measured by the action via the `client` glob — Task 4. Non-deployed, gitignored probe dir — Global Constraints + Task 3 Step 4.
- **Placeholder scan:** No TBD/TODO; every code step shows full file or exact YAML/JSON; reference fixes name exact strings.
- **Type/name consistency:** `emitProbe(entryContents, outPath)` and `emitAllProbes(outDir)` are defined in Task 2 and consumed by the same task's CLI and test; `size:build` defined in Task 3 and consumed in Task 4; probe paths (`framework/core.js`, `ui/dialog.js`) consistent between emitter, test, and the action's glob.
