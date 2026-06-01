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
        raw: Math.max(0, combined.raw - core.raw),
        gzip: Math.max(0, combined.gzip - core.gzip),
        brotli: Math.max(0, combined.brotli - core.brotli),
      },
    };
  }
  return sectionA;
}

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
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  // Guard against a missing value swallowing the next flag (e.g. `--sha
  // --date ...`), which would otherwise write a malformed history row.
  return v === undefined || v.startsWith('--') ? undefined : v;
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
