#!/usr/bin/env node
// Pure renderer: turns (freshReport, baselineReport) into the sticky PR comment
// markdown. CLI form reads two JSON files and prints the markdown.

import { readFileSync } from 'node:fs';
import { tableGzip, componentTableGzip } from './client-size-config.mjs';

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

// One table row: "| name | size | delta vs base |".
function row(name, freshGzip, baseGzip) {
  if (freshGzip === undefined) return `| ${name} | (removed) | |`;
  return `| ${name} | ${fmtBytes(freshGzip)} | ${fmtDelta(freshGzip, baseGzip)} |`;
}

function sectionAGzip(report, bucket) {
  const e = report.sectionA[bucket];
  return e ? tableGzip(bucket, e) : undefined;
}

function sectionCGzip(report, name) {
  const e = report.sectionC?.[name];
  return e ? componentTableGzip(name, e) : undefined;
}

// Footer that pins the comment to the commit it measured. The sticky comment
// updates in place on every push, so without this a re-measured comment is
// indistinguishable from the original at-open one (GitHub freezes the
// created-at timestamp and only quietly marks it "edited").
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
  const lines = [COMMENT_HEADER, '## Client JS size', ''];

  // Section A. The `core` row is the full size of the base framework bundle;
  // each feature row is the extra it adds on top of core, not its size alone.
  lines.push('### Framework runtime (gzip)');
  lines.push(
    '<sub>`core` is the base bundle; each feature is the extra it adds on top of core.</sub>'
  );
  lines.push('| Feature | Size | Δ vs base |');
  lines.push('|---|---|---|');
  const aBuckets = new Set([
    ...Object.keys(fresh.sectionA),
    ...Object.keys(baseline.sectionA),
  ]);
  for (const bucket of aBuckets) {
    lines.push(
      row(bucket, sectionAGzip(fresh, bucket), sectionAGzip(baseline, bucket))
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
      row(bucket, fresh.sectionB.buckets[bucket], baseline.sectionB.buckets[bucket])
    );
  }
  lines.push(row('**total**', fresh.sectionB.total, baseline.sectionB.total));
  lines.push('');

  // Section C (per-component; only when the fresh report carries one). Same
  // shape as Section A: `ui-core` is the full size of the shared primitives,
  // each component is the extra it adds on top.
  if (fresh.sectionC && Object.keys(fresh.sectionC).length > 0) {
    lines.push('### Components (gzip)');
    lines.push(
      '<sub>`ui-core` is the shared primitives; each component is the extra it adds on top.</sub>'
    );
    lines.push('| Component | Size | Δ vs base |');
    lines.push('|---|---|---|');
    const cNames = new Set([
      ...Object.keys(fresh.sectionC),
      ...Object.keys(baseline.sectionC ?? {}),
    ]);
    for (const name of cNames) {
      lines.push(row(name, sectionCGzip(fresh, name), sectionCGzip(baseline, name)));
    }
    lines.push('');
  }

  const footer = freshnessFooter(meta);
  if (footer) lines.push(footer);
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
  const meta = {
    sha: process.env.SIZE_COMMENT_SHA,
    runUrl: process.env.SIZE_COMMENT_RUN_URL,
    // Second precision; milliseconds add noise without telling the reader anything.
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  process.stdout.write(renderComment(fresh, baseline, meta) + '\n');
}
