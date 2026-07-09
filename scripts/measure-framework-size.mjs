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
//
// Filters the module list to what actually exists under `distBase` first: a
// manifest bucket can list a module that is new on HEAD (e.g. a PR adding
// boot-client.js) and therefore absent from a BASE-ref dist being measured in
// the same CI job. Without the filter, esbuild fails to resolve the missing
// path and the whole measurement crashes; with it, the module simply measures
// as absent on that ref instead.
function entryFor(modules, distBase) {
  return modules
    .filter((m) => existsSync(join(distBase, m)))
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
