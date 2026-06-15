# Lighthouse in CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a soft, per-PR Lighthouse sticky comment, a committed `main` baseline + history, and a single shields.io Performance badge, all riding the existing client-size measurement rails.

**Architecture:** Build the site, serve the real SSR worker with `wrangler dev` locally, run Lighthouse CI (`@lhci/cli`) against three pages, then two hand-rolled scripts (mirroring `measure-client-size.mjs` / `render-size-comment.mjs`) extract median scores into committed JSON and render the PR comment. CI gets a PR-only `lighthouse` job plus a baseline-commit extension to `build-and-tag`. Never fails the build.

**Tech Stack:** `@lhci/cli`, Node ESM scripts, vitest, `wrangler dev --local`, GitHub Actions, `marocchino/sticky-pull-request-comment`, shields.io endpoint badge.

**Spec:** `docs/superpowers/specs/2026-06-15-lighthouse-ci-design.md`

**Per the user's "keep both" decision after spec review:** `lighthouse-history.jsonl` carries **both** category scores **and** metrics (not scores-only), and the `temporary-public-storage` upload is kept. This plan reflects that; the spec's history-schema note was updated to match.

---

## File Structure

**New files**

- `.lighthouserc.json` (root) — LHCI collect + upload config. One responsibility: tell LHCI which URLs to run, how many times, and where to upload.
- `scripts/measure-lighthouse.mjs` — extraction. Reads LHCI's `.lighthouseci/` output, writes `lighthouse-report.json`, and (with flags) appends history + writes the badge. Pure core (`parseManifest`, `historyRow`, `badgePayload`, `pageKey`) + IO wrapper (`extractReport`) + CLI block.
- `scripts/render-lighthouse-comment.mjs` — pure `renderComment(fresh, baseline, meta)` + CLI block. One responsibility: turn two report objects into the sticky-comment markdown.
- `scripts/__tests__/measure-lighthouse.test.mjs` — units for the extraction module.
- `scripts/__tests__/render-lighthouse-comment.test.mjs` — units for the renderer.
- `lighthouse-report.json`, `lighthouse-history.jsonl`, `lighthouse-badge.json` (root) — committed baselines. Seeded from one local run; CI keeps them current.

**Modified files**

- `package.json` (root) — add `@lhci/cli` devDependency + `measure:lighthouse` script.
- `.github/workflows/ci.yml` — new PR-only `lighthouse` job; extend `build-and-tag` to fold the three Lighthouse artifacts into the existing `[skip ci]` baseline commit.
- `README.md` — shields.io badge near the top.
- `CLAUDE.md` — note the new dependency, the three artifacts, and that Lighthouse is CI-only.

> The `format` glob (`packages/**`, `apps/**/src/**`) excludes `scripts/**` and root JSON, so none of the new scripts or artifacts trip `format:check`. Keep them prettier-clean by hand anyway.

## Prerequisite for Task 4 (seeding)

Task 4 runs the real pipeline locally to produce honest seed numbers. It needs **Google Chrome installed locally** and a working `wrangler dev`. The implementer is on macOS with Chrome, so this is fine. If running in a worktree, run `pnpm wt:setup` first. A no-Chrome fallback is documented inside Task 4.

---

### Task 1: Add `@lhci/cli` and the LHCI config

**Files:**
- Modify: `package.json` (root) — `devDependencies` + `scripts`
- Create: `.lighthouserc.json` (root)

- [ ] **Step 1: Install the dependency**

Run (lets pnpm pin the current version into the lockfile rather than guessing):

```bash
pnpm add -Dw @lhci/cli
```

Expected: `package.json` gains `"@lhci/cli": "^0.x.y"` under `devDependencies`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Verify the binary resolves**

Run:

```bash
pnpm exec lhci --version
```

Expected: prints a version (e.g. `0.14.0`), exit 0.

- [ ] **Step 3: Add a convenience script**

In `package.json` `scripts`, add (next to the other `measure`/`release` scripts):

```json
"measure:lighthouse": "node scripts/measure-lighthouse.mjs",
```

- [ ] **Step 4: Write `.lighthouserc.json`**

Create `.lighthouserc.json`:

```json
{
  "ci": {
    "collect": {
      "url": [
        "http://localhost:8788/",
        "http://localhost:8788/docs/quick-start",
        "http://localhost:8788/demo"
      ],
      "numberOfRuns": 3,
      "settings": {
        "chromeFlags": "--no-sandbox"
      }
    },
    "upload": {
      "target": "temporary-public-storage"
    }
  }
}
```

- [ ] **Step 5: Validate the config is well-formed JSON**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('.lighthouserc.json','utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml .lighthouserc.json
git commit -m "chore(ci): add @lhci/cli and Lighthouse CI config"
```

---

### Task 2: `measure-lighthouse.mjs` (extraction)

**Files:**
- Create: `scripts/measure-lighthouse.mjs`
- Test: `scripts/__tests__/measure-lighthouse.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `scripts/__tests__/measure-lighthouse.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import {
  pageKey,
  parseManifest,
  extractReport,
  historyRow,
  badgePayload,
} from '../measure-lighthouse.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One representative + one non-representative run for '/', plus '/demo'.
function fixture() {
  const manifest = [
    {
      url: 'http://localhost:8788/',
      isRepresentativeRun: false,
      jsonPath: '/x/lhr-ignored.json',
      summary: { performance: 0.5, accessibility: 1, 'best-practices': 1, seo: 1 },
    },
    {
      url: 'http://localhost:8788/',
      isRepresentativeRun: true,
      jsonPath: '/x/lhr-home.json',
      summary: { performance: 0.975, accessibility: 1, 'best-practices': 1, seo: 0.92 },
    },
    {
      url: 'http://localhost:8788/demo',
      isRepresentativeRun: true,
      jsonPath: '/x/lhr-demo.json',
      summary: { performance: 0.85, accessibility: 0.95, 'best-practices': 1, seo: 1 },
    },
  ];
  const lhrs = {
    '/x/lhr-home.json': {
      audits: {
        'largest-contentful-paint': { numericValue: 1234.5 },
        'total-blocking-time': { numericValue: 0 },
        'cumulative-layout-shift': { numericValue: 0.0123 },
      },
    },
    '/x/lhr-demo.json': {
      audits: {
        'largest-contentful-paint': { numericValue: 2200 },
        'total-blocking-time': { numericValue: 50 },
        'cumulative-layout-shift': { numericValue: 0 },
      },
    },
  };
  const links = { 'http://localhost:8788/': 'https://storage.googleapis.com/report-home' };
  return { manifest, loadLhr: (p) => lhrs[p], links };
}

describe('pageKey', () => {
  it('reduces a collect URL to its pathname', () => {
    expect(pageKey('http://localhost:8788/docs/quick-start')).toBe('/docs/quick-start');
    expect(pageKey('http://localhost:8788/')).toBe('/');
  });
});

describe('parseManifest', () => {
  it('keeps only representative runs and rounds scores to 0-100', () => {
    const { manifest, loadLhr, links } = fixture();
    const report = parseManifest(manifest, loadLhr, links);
    expect(report.version).toBe(1);
    expect(Object.keys(report.pages)).toEqual(['/', '/demo']);
    expect(report.pages['/'].scores).toEqual({
      performance: 98, // round(0.975 * 100) = 98 (the 0.5 non-representative run is dropped)
      accessibility: 100,
      bestPractices: 100,
      seo: 92,
    });
  });

  it('reads headline metrics from the referenced LHR', () => {
    const { manifest, loadLhr, links } = fixture();
    const report = parseManifest(manifest, loadLhr, links);
    expect(report.pages['/'].metrics).toEqual({ lcp: 1235, tbt: 0, cls: 0.012 });
  });

  it('attaches a hosted report URL only when links has one', () => {
    const { manifest, loadLhr, links } = fixture();
    const report = parseManifest(manifest, loadLhr, links);
    expect(report.pages['/'].reportUrl).toBe('https://storage.googleapis.com/report-home');
    expect(report.pages['/demo'].reportUrl).toBeUndefined();
  });
});

describe('extractReport (IO wrapper)', () => {
  it('reads manifest.json + LHRs + links.json from a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lh-'));
    const homeLhr = join(dir, 'lhr-home.json');
    writeFileSync(
      homeLhr,
      JSON.stringify({
        audits: {
          'largest-contentful-paint': { numericValue: 900 },
          'total-blocking-time': { numericValue: 0 },
          'cumulative-layout-shift': { numericValue: 0 },
        },
      })
    );
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify([
        {
          url: 'http://localhost:8788/',
          isRepresentativeRun: true,
          jsonPath: homeLhr,
          summary: { performance: 1, accessibility: 1, 'best-practices': 1, seo: 1 },
        },
      ])
    );
    writeFileSync(
      join(dir, 'links.json'),
      JSON.stringify({ 'http://localhost:8788/': 'https://example/report' })
    );
    const report = extractReport(dir);
    expect(report.pages['/'].scores.performance).toBe(100);
    expect(report.pages['/'].reportUrl).toBe('https://example/report');
  });

  it('works without links.json (reportUrl omitted)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lh-'));
    const lhr = join(dir, 'lhr.json');
    writeFileSync(
      lhr,
      JSON.stringify({
        audits: {
          'largest-contentful-paint': { numericValue: 1000 },
          'total-blocking-time': { numericValue: 10 },
          'cumulative-layout-shift': { numericValue: 0.01 },
        },
      })
    );
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify([
        {
          url: 'http://localhost:8788/demo',
          isRepresentativeRun: true,
          jsonPath: lhr,
          summary: { performance: 0.8, accessibility: 1, 'best-practices': 1, seo: 1 },
        },
      ])
    );
    const report = extractReport(dir);
    expect(report.pages['/demo'].reportUrl).toBeUndefined();
    expect(report.pages['/demo'].scores.performance).toBe(80);
  });
});

describe('historyRow', () => {
  it('keeps scores + metrics per page, drops reportUrl, stamps sha/date', () => {
    const report = {
      version: 1,
      pages: {
        '/': {
          scores: { performance: 98, accessibility: 100, bestPractices: 100, seo: 92 },
          metrics: { lcp: 1235, tbt: 0, cls: 0.012 },
          reportUrl: 'https://example/report',
        },
      },
    };
    const row = historyRow(report, 'abc123', '2026-06-15T00:00:00Z');
    expect(row).toEqual({
      sha: 'abc123',
      date: '2026-06-15T00:00:00Z',
      pages: {
        '/': {
          scores: { performance: 98, accessibility: 100, bestPractices: 100, seo: 92 },
          metrics: { lcp: 1235, tbt: 0, cls: 0.012 },
        },
      },
    });
  });
});

describe('badgePayload', () => {
  it('uses the home Performance score with Lighthouse colour banding', () => {
    const mk = (performance) => ({ version: 1, pages: { '/': { scores: { performance } } } });
    expect(badgePayload(mk(98))).toEqual({
      schemaVersion: 1,
      label: 'lighthouse',
      message: '98',
      color: 'brightgreen',
    });
    expect(badgePayload(mk(72)).color).toBe('orange');
    expect(badgePayload(mk(40)).color).toBe('red');
  });

  it('falls back to 0/red when the home page is missing', () => {
    expect(badgePayload({ version: 1, pages: {} })).toEqual({
      schemaVersion: 1,
      label: 'lighthouse',
      message: '0',
      color: 'red',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm exec vitest run scripts/__tests__/measure-lighthouse.test.mjs
```

Expected: FAIL — `Failed to resolve import "../measure-lighthouse.mjs"` (module does not exist yet).

- [ ] **Step 3: Write `scripts/measure-lighthouse.mjs`**

Create `scripts/measure-lighthouse.mjs`:

```js
#!/usr/bin/env node
// Extracts Lighthouse scores from an LHCI `.lighthouseci/` run into the
// committed report/history/badge files. Mirrors measure-client-size.mjs:
// pure functions for testing + a CLI block.
//
// Usage:
//   node scripts/measure-lighthouse.mjs                     # write lighthouse-report.json from ./.lighthouseci
//   node scripts/measure-lighthouse.mjs --in DIR --out FILE
//   node scripts/measure-lighthouse.mjs --append-history --badge --sha <sha> --date <iso>

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_VERSION = 1;
const HOME = '/';

const round = (score01) => Math.round(score01 * 100);

// Reduce an LHCI collect URL ("http://localhost:8788/docs/quick-start") to the
// pathname we key pages by ("/docs/quick-start").
export function pageKey(url) {
  return new URL(url).pathname;
}

// Pure: build the report from parsed manifest entries, a loader that returns a
// parsed LHR for a jsonPath, and a url->reportUrl links map. Only representative
// (median) runs contribute. LHCI summary keys are Lighthouse category ids, so
// best-practices is hyphenated.
export function parseManifest(entries, loadLhr, links = {}) {
  const pages = {};
  for (const entry of entries) {
    if (!entry.isRepresentativeRun) continue;
    const key = pageKey(entry.url);
    const lhr = loadLhr(entry.jsonPath);
    const page = {
      scores: {
        performance: round(entry.summary.performance),
        accessibility: round(entry.summary.accessibility),
        bestPractices: round(entry.summary['best-practices']),
        seo: round(entry.summary.seo),
      },
      metrics: {
        lcp: Math.round(lhr.audits['largest-contentful-paint'].numericValue),
        tbt: Math.round(lhr.audits['total-blocking-time'].numericValue),
        cls: Number(lhr.audits['cumulative-layout-shift'].numericValue.toFixed(3)),
      },
    };
    const reportUrl = links[entry.url];
    if (reportUrl) page.reportUrl = reportUrl;
    pages[key] = page;
  }
  return { version: REPORT_VERSION, pages };
}

// IO wrapper: read manifest.json, each representative LHR, and optional
// links.json (written by `lhci upload --target=temporary-public-storage`).
export function extractReport(manifestDir) {
  const manifest = JSON.parse(readFileSync(join(manifestDir, 'manifest.json'), 'utf8'));
  const linksPath = join(manifestDir, 'links.json');
  const links = existsSync(linksPath) ? JSON.parse(readFileSync(linksPath, 'utf8')) : {};
  const loadLhr = (jsonPath) => JSON.parse(readFileSync(jsonPath, 'utf8'));
  return parseManifest(manifest, loadLhr, links);
}

// Flatten a report into a history row: scores + metrics per page, reportUrl
// dropped (it expires), stamped with sha/date.
export function historyRow(report, sha, date) {
  const pages = {};
  for (const [key, page] of Object.entries(report.pages)) {
    pages[key] = { scores: page.scores, metrics: page.metrics };
  }
  return { sha, date, pages };
}

function bandColor(score) {
  if (score >= 90) return 'brightgreen';
  if (score >= 50) return 'orange';
  return 'red';
}

// shields.io endpoint schema for the home Performance score.
export function badgePayload(report) {
  const perf = report.pages[HOME]?.scores.performance ?? 0;
  return { schemaVersion: 1, label: 'lighthouse', message: String(perf), color: bandColor(perf) };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  // Guard against a missing value swallowing the next flag.
  return v === undefined || v.startsWith('--') ? undefined : v;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const inDir = arg('in') ?? join(ROOT, '.lighthouseci');
  const outPath = arg('out') ?? join(ROOT, 'lighthouse-report.json');
  const report = extractReport(inDir);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${outPath} (home performance ${report.pages[HOME]?.scores.performance ?? 'n/a'})`);

  if (process.argv.includes('--append-history')) {
    const sha = arg('sha');
    const date = arg('date');
    if (!sha || !date) {
      console.error('--append-history requires --sha and --date');
      process.exit(1);
    }
    const historyPath = join(ROOT, 'lighthouse-history.jsonl');
    appendFileSync(historyPath, JSON.stringify(historyRow(report, sha, date)) + '\n');
    console.log(`Appended history row for ${sha} to ${historyPath}`);
  }
  if (process.argv.includes('--badge')) {
    const badgePath = join(ROOT, 'lighthouse-badge.json');
    writeFileSync(badgePath, JSON.stringify(badgePayload(report), null, 2) + '\n');
    console.log(`Wrote ${badgePath}`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm exec vitest run scripts/__tests__/measure-lighthouse.test.mjs
```

Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add scripts/measure-lighthouse.mjs scripts/__tests__/measure-lighthouse.test.mjs
git commit -m "feat(scripts): add Lighthouse report extraction (measure-lighthouse)"
```

---

### Task 3: `render-lighthouse-comment.mjs` (PR comment renderer)

**Files:**
- Create: `scripts/render-lighthouse-comment.mjs`
- Test: `scripts/__tests__/render-lighthouse-comment.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `scripts/__tests__/render-lighthouse-comment.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { renderComment } from '../render-lighthouse-comment.mjs';

function page(scores = {}, metrics = {}, reportUrl) {
  const p = {
    scores: { performance: 95, accessibility: 100, bestPractices: 100, seo: 100, ...scores },
    metrics: { lcp: 1200, tbt: 0, cls: 0, ...metrics },
  };
  if (reportUrl) p.reportUrl = reportUrl;
  return p;
}

function report(pages) {
  return { version: 1, pages };
}

describe('renderComment', () => {
  it('renders a per-page table and a dash for unchanged scores', () => {
    const r = report({ '/': page() });
    const md = renderComment(r, r);
    expect(md).toContain('<!-- lighthouse -->');
    expect(md).toContain('## Lighthouse');
    expect(md).toContain('`/`');
    expect(md).toMatch(/Performance.*95\/100.*—/s);
  });

  it('shows a signed delta for a regression and an improvement', () => {
    const baseline = report({ '/': page({ performance: 95 }) });
    const fresh = report({ '/': page({ performance: 91 }) });
    expect(renderComment(fresh, baseline)).toMatch(/Performance.*91\/100.*-4/s);

    const up = report({ '/': page({ performance: 99 }) });
    expect(renderComment(up, baseline)).toMatch(/Performance.*99\/100.*\+4/s);
  });

  it('marks a new page and a removed page', () => {
    const baseline = report({ '/': page(), '/demo': page() });
    const fresh = report({ '/': page(), '/docs/quick-start': page() });
    const md = renderComment(fresh, baseline);
    expect(md).toContain('(new)'); // /docs/quick-start scores are new
    expect(md).toContain('(removed)'); // /demo present in baseline, gone in fresh
  });

  it('renders a metrics sub-line for each fresh page', () => {
    const r = report({ '/': page({}, { lcp: 1500, tbt: 12, cls: 0.03 }) });
    const md = renderComment(r, r);
    expect(md).toContain('LCP 1500 ms');
    expect(md).toContain('TBT 12 ms');
    expect(md).toContain('CLS 0.03');
  });

  it('links the page heading to the hosted report when present', () => {
    const r = report({ '/': page({}, {}, 'https://storage/report-home') });
    expect(renderComment(r, r)).toContain('### [`/`](https://storage/report-home)');
  });

  it('omits the freshness footer when no meta is given', () => {
    const r = report({ '/': page() });
    expect(renderComment(r, r)).not.toContain('Measured');
  });

  it('renders a freshness footer with short sha, timestamp, and run link', () => {
    const r = report({ '/': page() });
    const md = renderComment(r, r, {
      sha: '2af64e6d9abc123',
      generatedAt: '2026-06-15T01:36:33Z',
      runUrl: 'https://github.com/o/r/actions/runs/123',
    });
    expect(md).toContain('Measured `2af64e6d9`');
    expect(md).toContain('2026-06-15T01:36:33Z');
    expect(md).toContain('[run](https://github.com/o/r/actions/runs/123)');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm exec vitest run scripts/__tests__/render-lighthouse-comment.test.mjs
```

Expected: FAIL — `Failed to resolve import "../render-lighthouse-comment.mjs"`.

- [ ] **Step 3: Write `scripts/render-lighthouse-comment.mjs`**

Create `scripts/render-lighthouse-comment.mjs`:

```js
#!/usr/bin/env node
// Pure renderer: turns (freshReport, baselineReport) into the Lighthouse sticky
// PR comment markdown. CLI form reads two JSON files and prints the markdown.
// Mirrors render-size-comment.mjs.

import { readFileSync } from 'node:fs';

const COMMENT_HEADER = '<!-- lighthouse -->';

const CATEGORY_ORDER = ['performance', 'accessibility', 'bestPractices', 'seo'];
const CATEGORY_LABELS = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  bestPractices: 'Best Practices',
  seo: 'SEO',
};

function fmtDelta(fresh, base) {
  if (base === undefined) return '(new)';
  const d = fresh - base;
  if (d === 0) return '—';
  // Negative numbers already carry their '-'; only positives need a '+'.
  return (d > 0 ? '+' : '') + d;
}

// One category row: "| Performance | 95/100 | +4 |".
function scoreRow(label, fresh, base) {
  if (fresh === undefined) return `| ${label} | (removed) | |`;
  return `| ${label} | ${fresh}/100 | ${fmtDelta(fresh, base)} |`;
}

function metricsLine(metrics) {
  if (!metrics) return undefined;
  return `<sub>LCP ${metrics.lcp} ms · TBT ${metrics.tbt} ms · CLS ${metrics.cls}</sub>`;
}

// Footer pinning the comment to the measured commit, identical in spirit to the
// client-size footer (the sticky comment edits in place on every push).
function freshnessFooter(meta) {
  if (!meta) return undefined;
  const parts = [];
  if (meta.sha) parts.push(`\`${meta.sha.slice(0, 9)}\``);
  if (meta.generatedAt) parts.push(meta.generatedAt);
  if (meta.runUrl) parts.push(`[run](${meta.runUrl})`);
  if (parts.length === 0) return undefined;
  return `<sub>Measured ${parts.join(' · ')}</sub>`;
}

export function renderComment(fresh, baseline, meta) {
  const lines = [COMMENT_HEADER, '## Lighthouse', ''];
  const keys = new Set([
    ...Object.keys(fresh.pages),
    ...Object.keys(baseline.pages ?? {}),
  ]);
  for (const key of keys) {
    const fp = fresh.pages[key];
    const bp = baseline.pages?.[key];
    lines.push(fp?.reportUrl ? `### [\`${key}\`](${fp.reportUrl})` : `### \`${key}\``);
    const m = fp ? metricsLine(fp.metrics) : undefined;
    if (m) lines.push(m);
    lines.push('| Category | Score | Δ vs base |');
    lines.push('|---|---|---|');
    for (const cat of CATEGORY_ORDER) {
      lines.push(scoreRow(CATEGORY_LABELS[cat], fp?.scores[cat], bp?.scores[cat]));
    }
    lines.push('');
  }
  const footer = freshnessFooter(meta);
  if (footer) lines.push(footer);
  return lines.join('\n');
}

// CLI: render-lighthouse-comment.mjs <freshReport.json> <baselineReport.json>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [freshPath, basePath] = process.argv.slice(2);
  if (!freshPath || !basePath) {
    console.error('Usage: render-lighthouse-comment.mjs <freshReport.json> <baselineReport.json>');
    process.exit(1);
  }
  const fresh = JSON.parse(readFileSync(freshPath, 'utf8'));
  const baseline = JSON.parse(readFileSync(basePath, 'utf8'));
  const meta = {
    sha: process.env.LH_COMMENT_SHA,
    runUrl: process.env.LH_COMMENT_RUN_URL,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  process.stdout.write(renderComment(fresh, baseline, meta) + '\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm exec vitest run scripts/__tests__/render-lighthouse-comment.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/render-lighthouse-comment.mjs scripts/__tests__/render-lighthouse-comment.test.mjs
git commit -m "feat(scripts): add Lighthouse PR comment renderer"
```

---

### Task 4: Seed the committed baseline artifacts (local run)

**Files:**
- Create: `lighthouse-report.json`, `lighthouse-history.jsonl`, `lighthouse-badge.json` (root)

This task runs the real pipeline once to produce honest seed numbers. **Requires Chrome locally.** The exact `wrangler dev` invocation confirmed here is reused verbatim in Task 5's CI steps.

- [ ] **Step 1: Build the framework packages and the site**

Run:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm --filter site build
```

Expected: `apps/site/dist/hono_preact/wrangler.json` and `apps/site/dist/client/` exist.

- [ ] **Step 2: Serve the built worker locally**

The built config's paths are relative to its own location, so run wrangler from inside `apps/site`. In one terminal:

```bash
cd apps/site && pnpm exec wrangler dev -c dist/hono_preact/wrangler.json --local --port 8788
```

Expected: wrangler reports it is serving on `http://localhost:8788`. If this wrangler version rejects `--local` ("Unknown argument: local"), drop it — local is the default in wrangler v4 — and note the working command for Task 5.

- [ ] **Step 3: Sanity-check the three URLs respond**

In a second terminal:

```bash
curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:8788/ \
  && curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:8788/docs/quick-start \
  && curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:8788/demo
```

Expected: three `200` lines.

- [ ] **Step 4: Collect + upload with LHCI (from repo root)**

In the second terminal, from the repo root:

```bash
pnpm exec lhci collect --config=.lighthouserc.json
pnpm exec lhci upload --config=.lighthouserc.json || true
```

Expected: `.lighthouseci/manifest.json` plus `lhr-*.json` exist; upload prints hosted report URLs (and writes `.lighthouseci/links.json`). The `|| true` tolerates a storage outage.

- [ ] **Step 5: Write the three committed artifacts**

```bash
node scripts/measure-lighthouse.mjs --in .lighthouseci --append-history --badge \
  --sha "$(git rev-parse HEAD)" --date "$(git show -s --format=%cI HEAD)"
```

Expected: writes `lighthouse-report.json` + `lighthouse-badge.json` and appends one row to `lighthouse-history.jsonl`. Stop the wrangler process from Step 2. Inspect the files:

```bash
cat lighthouse-badge.json
node -e "const r=require('./lighthouse-report.json'); console.log(Object.keys(r.pages), r.pages['/'].scores)"
```

Expected: badge JSON has a numeric `message` and a colour; the report has the three page keys with score objects.

**No-Chrome fallback (only if Step 2–4 cannot run locally):** hand-write structurally valid seeds so the comment renders and the badge endpoint resolves; CI overwrites both on the first `main` merge. Create `lighthouse-report.json`:

```json
{
  "version": 1,
  "pages": {
    "/": { "scores": { "performance": 90, "accessibility": 100, "bestPractices": 100, "seo": 100 }, "metrics": { "lcp": 1500, "tbt": 0, "cls": 0 } },
    "/docs/quick-start": { "scores": { "performance": 90, "accessibility": 100, "bestPractices": 100, "seo": 100 }, "metrics": { "lcp": 1500, "tbt": 0, "cls": 0 } },
    "/demo": { "scores": { "performance": 90, "accessibility": 100, "bestPractices": 100, "seo": 100 }, "metrics": { "lcp": 1500, "tbt": 0, "cls": 0 } }
  }
}
```

`lighthouse-badge.json`:

```json
{ "schemaVersion": 1, "label": "lighthouse", "message": "90", "color": "brightgreen" }
```

`lighthouse-history.jsonl`: create empty (`: > lighthouse-history.jsonl`); CI appends the first real row.

- [ ] **Step 6: Commit**

```bash
git add lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
git commit -m "chore(metrics): seed committed Lighthouse baseline artifacts"
```

---

### Task 5: CI wiring (`.github/workflows/ci.yml`)

**Files:**
- Modify: `.github/workflows/ci.yml`

Adds a PR-only `lighthouse` job mirroring `client-size`, and extends `build-and-tag` to fold the three Lighthouse artifacts into the existing baseline commit. Reuse the exact `wrangler dev` command confirmed in Task 4 (with or without `--local`).

- [ ] **Step 1: Add the `lighthouse` job**

In `.github/workflows/ci.yml`, after the `client-size` job (before `build-and-tag`), insert:

```yaml
  lighthouse:
    name: Lighthouse
    needs: test
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
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
        run: pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build

      - name: Build site
        run: pnpm --filter site build

      - name: Serve, collect, and upload
        run: |
          set -o pipefail
          (cd apps/site && pnpm exec wrangler dev -c dist/hono_preact/wrangler.json --local --port 8788) > wrangler.log 2>&1 &
          WRANGLER_PID=$!
          ready=
          for i in $(seq 1 30); do
            if curl -sf -o /dev/null http://localhost:8788/; then ready=1; break; fi
            sleep 1
          done
          if [ -z "$ready" ]; then echo "wrangler did not become ready"; cat wrangler.log; kill $WRANGLER_PID || true; exit 1; fi
          pnpm exec lhci collect --config=.lighthouserc.json
          pnpm exec lhci upload --config=.lighthouserc.json || true
          kill $WRANGLER_PID || true

      - name: Extract PR scores
        run: node scripts/measure-lighthouse.mjs --in .lighthouseci --out /tmp/fresh-lh.json

      - name: Render comment
        env:
          LH_COMMENT_SHA: ${{ github.event.pull_request.head.sha }}
          LH_COMMENT_RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: node scripts/render-lighthouse-comment.mjs /tmp/fresh-lh.json lighthouse-report.json > /tmp/lh-comment.md

      - name: Post sticky comment
        uses: marocchino/sticky-pull-request-comment@v2
        with:
          header: lighthouse
          path: /tmp/lh-comment.md
```

- [ ] **Step 2: Extend `build-and-tag` to measure Lighthouse on `main`**

In the `build-and-tag` job, the `Build all packages and app` step already runs `pnpm build` (packages + site), so `dist/hono_preact/` exists. Replace the existing **"Update client size baseline + history"** step with the following three steps (this splits the size measurement from the commit so both baselines land in one commit):

```yaml
      - name: Measure client size baseline
        run: |
          node scripts/measure-client-size.mjs \
            --append-history \
            --sha "$GITHUB_SHA" \
            --date "$(git show -s --format=%cI "$GITHUB_SHA")"

      - name: Measure Lighthouse baseline
        run: |
          set -o pipefail
          (cd apps/site && pnpm exec wrangler dev -c dist/hono_preact/wrangler.json --local --port 8788) > wrangler.log 2>&1 &
          WRANGLER_PID=$!
          ready=
          for i in $(seq 1 30); do
            if curl -sf -o /dev/null http://localhost:8788/; then ready=1; break; fi
            sleep 1
          done
          if [ -z "$ready" ]; then echo "wrangler did not become ready"; cat wrangler.log; kill $WRANGLER_PID || true; exit 1; fi
          pnpm exec lhci collect --config=.lighthouserc.json
          pnpm exec lhci upload --config=.lighthouserc.json || true
          kill $WRANGLER_PID || true
          node scripts/measure-lighthouse.mjs --in .lighthouseci --append-history --badge \
            --sha "$GITHUB_SHA" --date "$(git show -s --format=%cI "$GITHUB_SHA")"

      - name: Commit baselines
        run: |
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git config user.name "github-actions[bot]"
          if ! git diff --quiet client-size-report.json client-size-history.jsonl lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json; then
            git add client-size-report.json client-size-history.jsonl lighthouse-report.json lighthouse-history.jsonl lighthouse-badge.json
            git commit -m "chore(metrics): update size + lighthouse baselines [skip ci]"
            git push origin HEAD:main
          fi
```

Leave the subsequent **"Move next tag to HEAD"** step unchanged (it already anchors the tag to `$GITHUB_SHA`, which is correct even after the baseline commit advances local `HEAD`).

- [ ] **Step 3: Validate the workflow YAML parses**

Run:

```bash
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/^  lighthouse:/m.test(c)) throw new Error('lighthouse job missing'); if(!/Commit baselines/.test(c)) throw new Error('baseline commit step missing'); console.log('ok')"
```

Expected: `ok`. (If `actionlint` is installed, also run `actionlint .github/workflows/ci.yml` and expect no errors.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run Lighthouse on PRs and commit baseline on main"
```

---

### Task 6: README badge + CLAUDE.md notes

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the badge to `README.md`**

In `README.md`, immediately after the links line (`[**Docs**]… · [**GitHub**]…`), add a blank line then:

```markdown
[![Lighthouse Performance](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/sbesh91/hono-preact/main/lighthouse-badge.json)](https://framework.sbesh.com)
```

- [ ] **Step 2: Add a CLAUDE.md note**

In `CLAUDE.md`, at the end of the **"Pre-push verification"** section (after the paragraph ending "...trivially fixable, but reliably forgotten."), add:

```markdown

Lighthouse runs in **CI only** and is deliberately **not** part of the six steps above (it builds, serves the worker with `wrangler dev`, and drives Chrome, far too slow for a pre-push gate). The PR-only `lighthouse` job posts a soft sticky comment; the `main` push job commits the `lighthouse-report.json` / `lighthouse-history.jsonl` / `lighthouse-badge.json` baselines alongside the client-size ones. Tooling: `@lhci/cli` (root devDependency); config in `.lighthouserc.json`; extraction/rendering in `scripts/measure-lighthouse.mjs` and `scripts/render-lighthouse-comment.mjs` (unit-tested under `scripts/__tests__/`).
```

- [ ] **Step 3: Verify the badge file path matches the README URL**

Run:

```bash
test -f lighthouse-badge.json && grep -q "main/lighthouse-badge.json" README.md && echo "ok"
```

Expected: `ok` (the committed badge file exists and the README points at it on `main`).

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add Lighthouse Performance badge and CI notes"
```

---

### Task 7: Full local verification

**Files:** none (verification only)

- [ ] **Step 1: Run the new unit tests**

```bash
pnpm exec vitest run scripts/__tests__/measure-lighthouse.test.mjs scripts/__tests__/render-lighthouse-comment.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run the CI-mirror pre-push checks**

Per `CLAUDE.md` (Lighthouse itself is CI-only and excluded here):

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: every step exits 0. (If `format:check` fails, run `pnpm format`, commit, and re-run; the new scripts/JSON are outside the glob, so the likely culprit is something else.)

- [ ] **Step 3: Dry-run the comment renderer end-to-end**

Render a comment from the seeded baseline against itself to confirm the CLI path works:

```bash
node scripts/render-lighthouse-comment.mjs lighthouse-report.json lighthouse-report.json | head -20
```

Expected: markdown beginning with `<!-- lighthouse -->` and `## Lighthouse`, one table per page, all deltas `—`.

- [ ] **Step 4: Confirm the working tree is clean**

```bash
git status --porcelain
```

Expected: empty (every change committed). The branch is ready to push and open a PR.

---

## Self-Review

**Spec coverage** (each spec section maps to a task):

- Hermetic serve + 3 pages → Task 1 (config URLs), Task 4 (serve confirmation), Task 5 (CI serve).
- Soft/informational, never fails build → Task 5 (`lighthouse` job has no failing assertion; upload is `|| true`).
- LHCI tool → Task 1.
- `measure-lighthouse.mjs` (report/history/badge) → Task 2.
- `render-lighthouse-comment.mjs` → Task 3.
- Committed artifacts (report/history/badge) → Task 4 (seed), Task 5 (CI maintains).
- PR sticky comment + `main` baseline commit → Task 5.
- README badge → Task 6.
- CLAUDE.md / dependency notes → Task 6.
- History carries scores **and** metrics; upload kept → Task 2 (`historyRow`), Task 1/4/5 (upload). Reflects the "keep both" decision.

**Type/name consistency:** `parseManifest`, `extractReport`, `historyRow`, `badgePayload`, `pageKey`, `renderComment` are used identically in tests and implementations. Report shape `{ version, pages: { [key]: { scores: {performance,accessibility,bestPractices,seo}, metrics: {lcp,tbt,cls}, reportUrl? } } }` is consistent across Tasks 2, 3, 4, and the comment renderer. Env vars `LH_COMMENT_SHA` / `LH_COMMENT_RUN_URL` match between Task 3's CLI and Task 5's job. Badge file path `lighthouse-badge.json` matches the README URL in Task 6.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the no-Chrome fallback gives literal JSON.
