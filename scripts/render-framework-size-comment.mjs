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
