// Coverage analysis over the built dist for the manifest-completeness gate.
//
// The size probe (measure-framework-size.mjs) only reports the buckets listed
// in size-probe-config.mjs. A client module that ships but is attributed to no
// bucket is measured by no row, so it can grow unbounded without the size
// comment noticing. That is exactly how realtime and use-prefetch went
// unmeasured before this gate existed. These helpers recompute, from dist, what
// the manifest actually covers, so a test can fail when a new client module
// slips through.
//
// Config is imported as a namespace so a not-yet-added export (e.g.
// EXCLUDED_MODULES during a red test) reads as undefined instead of throwing.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import * as config from './size-probe-config.mjs';

// Matches static `from '...'` / `import '...'` and dynamic `import('...')`.
const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

// Relative module specifiers imported by `rel` (a dist-relative .js path).
// Peer/external specifiers (preact, hono) are not our modules, so they drop.
export function resolveImports(distDir, rel) {
  const full = join(distDir, rel);
  if (!existsSync(full)) return [];
  const src = readFileSync(full, 'utf8');
  const out = new Set();
  for (const [, spec] of src.matchAll(IMPORT_RE)) {
    if (!spec.startsWith('.')) continue;
    let p = normalize(join(dirname(rel), spec));
    if (!p.endsWith('.js')) p += '.js';
    out.add(p);
  }
  return [...out];
}

// Transitive closure of the seed modules within distDir.
export function closure(distDir, seeds) {
  const seen = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur) || !existsSync(join(distDir, cur))) continue;
    seen.add(cur);
    stack.push(...resolveImports(distDir, cur));
  }
  return seen;
}

// Everything the manifest attributes to a bucket: the core + feature entries
// plus their whole transitive graph, since a bucket entry force-includes what
// it imports (so a feature that drags in a new internal module is still
// covered, and only a brand-new top-level entry point can be a gap).
export function coveredModules(distDir) {
  const entries = [
    ...config.CORE_MODULES,
    ...Object.values(config.FEATURE_MODULES).flat(),
  ];
  return closure(distDir, entries);
}

// Top-level .js modules in the dist root (the public-surface entry points).
// Subdirectories (internal/) and .d.ts/.map files are not entry points.
export function topLevelModules(distDir) {
  return readdirSync(distDir).filter((f) => f.endsWith('.js'));
}

// Top-level modules that are neither covered by a bucket nor explicitly
// excluded (server-only / barrel / type-only). A non-empty result is drift.
export function uncoveredClientModules(distDir) {
  const covered = coveredModules(distDir);
  const excluded = new Set(config.EXCLUDED_MODULES ?? []);
  return topLevelModules(distDir)
    .filter((m) => !covered.has(m) && !excluded.has(m))
    .sort();
}

// UI dist modules imported by at least `min` of the public components. These
// are the shared substrate that must live in ui-core to keep component rows
// additive (a shared module left out is re-counted in every component's row).
export function sharedUiModules(uiDist, min = 3) {
  const counts = new Map();
  for (const mods of Object.values(config.COMPONENT_MODULES)) {
    for (const m of closure(uiDist, mods)) {
      if (m.endsWith('/index.js')) continue; // a component's own entry
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= min)
    .map(([m]) => m)
    .sort();
}
