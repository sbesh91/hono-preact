#!/usr/bin/env node
// Pure renderer: turns (freshReport, baselineReport, config) into the sticky PR
// comment markdown. CLI form reads two JSON files and prints the markdown.

import { readFileSync } from 'node:fs';
import * as defaultConfig from './client-size-config.mjs';
import { tableGzip } from './client-size-config.mjs';

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

// One table row: "| name | size | delta |".
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
  return e ? tableGzip(bucket, e) : undefined;
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
    // Section B per-bucket rows are unbudgeted; only the total row has a budget
    // (`site:total`). Passing budgets[bucket] here would collide with Section
    // A's `core` budget and flag the site `core` chunk bucket on every PR.
    lines.push(
      row(bucket, fresh.sectionB.buckets[bucket], baseline.sectionB.buckets[bucket], undefined)
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
  if (!freshPath || !basePath) {
    console.error(
      'Usage: render-size-comment.mjs <freshReport.json> <baselineReport.json>'
    );
    process.exit(1);
  }
  const fresh = JSON.parse(readFileSync(freshPath, 'utf8'));
  const baseline = JSON.parse(readFileSync(basePath, 'utf8'));
  process.stdout.write(renderComment(fresh, baseline) + '\n');
}
