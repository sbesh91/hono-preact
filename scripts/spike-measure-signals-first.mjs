// SPIKE (throwaway): decompose the cost of going FULLY signals-first.
// Same methodology as measure-framework-size.mjs (production define, peers
// external, minify, gzip).
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTERNAL,
  CORE_MODULES,
  FEATURE_MODULES,
} from './size-probe-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ISO = resolve(join(ROOT, 'packages/iso/dist'));

function entryFor(mods) {
  return mods
    .filter((m) => existsSync(join(ISO, m)))
    .map((m, i) => `export * as m${i} from '${join(ISO, m)}';`)
    .join('\n');
}

async function gz(contents) {
  const r = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'esnext',
    external: EXTERNAL,
    write: false,
    legalComments: 'none',
    logLevel: 'silent',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  });
  return gzipSync(Buffer.from(r.outputFiles[0].contents)).length;
}

const core = entryFor(CORE_MODULES);
// A realistic data-heavy app: core + boot runtime + loaders + actions + realtime.
const appMods = [
  ...CORE_MODULES,
  ...FEATURE_MODULES.runtime,
  ...FEATURE_MODULES.loaders,
  ...FEATURE_MODULES.actions,
  ...FEATURE_MODULES.realtime,
];
const app = entryFor(appMods);

const rows = {};
rows['core'] = await gz(core);
rows['core + signals'] = await gz(
  core + `\nexport * as sig from '@preact/signals';`
);
rows['app (core+runtime+loaders+actions+realtime)'] = await gz(app);
rows['app + signals'] = await gz(
  app + `\nexport * as sig from '@preact/signals';`
);
rows['@preact/signals alone'] = await gz(
  `export * as s from '@preact/signals';`
);
rows['@preact/signals-core alone'] = await gz(
  `export * as s from '@preact/signals-core';`
);

// Deletion candidates: the hand-rolled state bridges a signals-first model
// would no longer need. Measured as unique bytes over the app bundle.
const bridges = [
  'internal/use-store-snapshot.js',
  'internal/use-force-update.js',
];
const appWithout = appMods.filter((m) => !bridges.includes(m));
rows['-- bridges, standalone'] = await gz(entryFor(bridges));

for (const [k, v] of Object.entries(rows)) {
  console.log(k.padEnd(46), String(v).padStart(6), 'B gz');
}
console.log();
const APP = 'app (core+runtime+loaders+actions+realtime)';
const marginalApp = rows['app + signals'] - rows[APP];
console.log(
  'signals marginal over core :',
  rows['core + signals'] - rows['core'],
  'B gz'
);
console.log(
  'signals marginal over app  :',
  marginalApp,
  'B gz',
  `(+${((marginalApp / rows[APP]) * 100).toFixed(1)}% on a data-heavy app)`
);
console.log(
  'deletable hand-rolled bridges:',
  rows['-- bridges, standalone'],
  'B gz'
);
console.log(
  'net if bridges are removed  :',
  marginalApp - rows['-- bridges, standalone'],
  'B gz'
);
void appWithout;
