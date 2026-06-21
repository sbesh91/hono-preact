#!/usr/bin/env node
// Emits one minified, isolated bundle per size probe so compressed-size-action
// can gzip and diff each on every PR. Framework probes come from
// packages/iso/dist, component probes from packages/ui/dist; EXTERNAL peers are
// excluded. Output layout:
//   <out>/framework/<core|feature>.js
//   <out>/ui/<core|component>.js
// Default <out> is apps/site/dist/size-probes (gitignored, not deployed).
//
// Usage: node scripts/emit-size-probes.mjs [--out <dir>]

import { build } from 'esbuild';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_MODULES,
  FEATURE_MODULES,
  EXTERNAL,
  UI_CORE_MODULES,
  COMPONENT_MODULES,
} from './size-probe-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Re-export each dist module by namespace so sideEffects:false tree-shaking
// cannot drop a side-effect-free import (entry-point exports are always kept).
function entryFor(modules, distBase) {
  return modules
    .map((m, i) => `export * as m${i} from './${distBase}/${m}';`)
    .join('\n');
}

// Bundle one probe entry in isolation and write the minified output to outPath.
export async function emitProbe(entryContents, outPath) {
  const result = await build({
    stdin: { contents: entryContents, resolveDir: ROOT, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    external: EXTERNAL,
    legalComments: 'none',
    logLevel: 'silent',
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.outputFiles[0].contents);
}

// Emit every probe under `outDir`. Returns the written paths. Skips the ui
// probes when packages/ui/dist is absent so a partial build never crashes.
export async function emitAllProbes(outDir) {
  const written = [];

  const frameworkProbes = { core: CORE_MODULES, ...FEATURE_MODULES };
  for (const [name, modules] of Object.entries(frameworkProbes)) {
    const outPath = join(outDir, 'framework', `${name}.js`);
    await emitProbe(entryFor(modules, 'packages/iso/dist'), outPath);
    written.push(outPath);
  }

  const uiBase = 'packages/ui/dist';
  if (existsSync(join(ROOT, uiBase))) {
    const uiProbes = { core: UI_CORE_MODULES, ...COMPONENT_MODULES };
    for (const [name, modules] of Object.entries(uiProbes)) {
      const outPath = join(outDir, 'ui', `${name}.js`);
      await emitProbe(entryFor(modules, uiBase), outPath);
      written.push(outPath);
    }
  }

  return written;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? undefined : v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = arg('out') ?? join(ROOT, 'apps/site/dist/size-probes');
  const written = await emitAllProbes(outDir);
  console.log(`Emitted ${written.length} size probe(s) under ${outDir}`);
}
