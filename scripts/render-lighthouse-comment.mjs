#!/usr/bin/env node
// Pure renderer: turns (fresh, baseline) reports into the sticky PR comment markdown.
// CLI form reads two JSON files and prints the markdown.

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
