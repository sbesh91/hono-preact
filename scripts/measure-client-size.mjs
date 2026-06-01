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
