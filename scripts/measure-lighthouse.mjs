#!/usr/bin/env node
// Extracts Lighthouse scores from an LHCI `.lighthouseci/` run into the
// committed report/history/badge files.
// Pure functions for testing + a CLI block.
//
// Usage:
//   node scripts/measure-lighthouse.mjs                     # write lighthouse-report.json from ./.lighthouseci
//   node scripts/measure-lighthouse.mjs --in DIR --out FILE
//   node scripts/measure-lighthouse.mjs --append-history --badge --sha <sha> --date <iso>
//   node scripts/measure-lighthouse.mjs --out-dir DIR --append-history --badge --sha <sha> --date <iso>

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

// Resolve the three output file paths. With `outDir`, all three live under it;
// otherwise they default to the repo root. `out` overrides the report path only,
// preserving the existing --out flag.
export function resolveOutputPaths({ root, outDir, out } = {}) {
  const base = outDir ?? root;
  return {
    report: out ?? join(base, 'lighthouse-report.json'),
    history: join(base, 'lighthouse-history.jsonl'),
    badge: join(base, 'lighthouse-badge.json'),
  };
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
  const outPath = resolveOutputPaths({ root: ROOT, outDir: arg('out-dir'), out: arg('out') });
  const report = extractReport(inDir);
  writeFileSync(outPath.report, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${outPath.report} (home performance ${report.pages[HOME]?.scores.performance ?? 'n/a'})`);

  if (process.argv.includes('--append-history')) {
    const sha = arg('sha');
    const date = arg('date');
    if (!sha || !date) {
      console.error('--append-history requires --sha and --date');
      process.exit(1);
    }
    const historyPath = outPath.history;
    appendFileSync(historyPath, JSON.stringify(historyRow(report, sha, date)) + '\n');
    console.log(`Appended history row for ${sha} to ${historyPath}`);
  }
  if (process.argv.includes('--badge')) {
    const badgePath = outPath.badge;
    writeFileSync(badgePath, JSON.stringify(badgePayload(report), null, 2) + '\n');
    console.log(`Wrote ${badgePath}`);
  }
}
