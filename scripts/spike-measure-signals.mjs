// SPIKE (throwaway): same methodology as scripts/measure-framework-size.mjs
// (isolated esbuild bundle, peers external, minified, gzip). Answers: what
// does @preact/signals add on top of the framework `core` probe?
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTERNAL, CORE_MODULES } from './size-probe-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ISO_DIST = resolve(join(ROOT, 'packages/iso/dist'));

function entryFor(modules, distBase) {
  return modules
    .filter((m) => existsSync(join(distBase, m)))
    .map((m, i) => `export * as m${i} from '${join(distBase, m)}';`)
    .join('\n');
}

async function bundleSize(contents) {
  const r = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'ts' },
    bundle: true, minify: true, format: 'esm', platform: 'browser',
    target: 'esnext', external: EXTERNAL, write: false, legalComments: 'none',
  });
  return gzipSync(r.outputFiles[0].contents).length;
}

const core = entryFor(CORE_MODULES, ISO_DIST);
const rows = {
  'framework core (baseline)': await bundleSize(core),
  'core + @preact/signals': await bundleSize(
    core + `\nexport * as sig from '@preact/signals';`
  ),
  '@preact/signals alone': await bundleSize(
    `export * as s from '@preact/signals';`
  ),
  '@preact/signals-core alone': await bundleSize(
    `export * as s from '@preact/signals-core';`
  ),
};

for (const [k, v] of Object.entries(rows)) {
  console.log(k.padEnd(28), String(v).padStart(6), 'B gz');
}
const marginal = rows['core + @preact/signals'] - rows['framework core (baseline)'];
console.log(
  '\nmarginal cost of signals over core:'.padEnd(38),
  marginal, 'B gz',
  `(+${((marginal / rows['framework core (baseline)']) * 100).toFixed(0)}% on core)`
);
