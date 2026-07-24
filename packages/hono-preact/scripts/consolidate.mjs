// Bundles iso, server, and vite workspace packages into the umbrella's dist/
// so the published `hono-preact` tarball is self-contained and the three
// internal packages stay workspace-private.
//
// Steps:
//   1. Copy each workspace package's dist/ into ./dist/{iso,server,vite}/
//      (skipping __tests__/, .tsbuildinfo, *.map).
//   2. Walk every .js and .d.ts in dist/ and rewrite cross-package imports
//      (`@hono-preact/iso[/internal]`, `@hono-preact/server`, `@hono-preact/vite`)
//      to file-relative paths.
//   3. Strip stale `//# sourceMappingURL=` references since we drop the maps.

import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES_DIR = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');

const SUBPACKAGES = [
  {
    name: 'iso',
    src: join(PACKAGES_DIR, 'iso', 'dist'),
    dest: join(DIST, 'iso'),
  },
  {
    name: 'server',
    src: join(PACKAGES_DIR, 'server', 'dist'),
    dest: join(DIST, 'server'),
  },
  {
    name: 'vite',
    src: join(PACKAGES_DIR, 'vite', 'dist'),
    dest: join(DIST, 'vite'),
  },
];

// Maps a published-source string to the consolidated dist path it should point at.
const DIST_PATHS = {
  '@hono-preact/iso/internal/runtime': 'iso/internal-runtime.js',
  '@hono-preact/iso/internal': 'iso/internal.js',
  '@hono-preact/iso/page': 'iso/page-only.js',
  '@hono-preact/iso/signals': 'iso/signals.js',
  '@hono-preact/iso': 'iso/index.js',
  '@hono-preact/server/internal/runtime': 'server/internal-runtime.js',
  '@hono-preact/server/internal/cloudflare': 'server/internal-cloudflare.js',
  '@hono-preact/server': 'server/index.js',
  '@hono-preact/vite': 'vite/index.js',
  '@hono-preact/vite/adapter-cloudflare': 'vite/adapter-cloudflare.js',
  '@hono-preact/vite/adapter-node': 'vite/adapter-node.js',
};

async function copyTree(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    if (entry.name.endsWith('.tsbuildinfo')) continue;
    if (entry.name.endsWith('.map')) continue;

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyTree(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

async function walk(dir, fn) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(p, fn);
    } else {
      await fn(p);
    }
  }
}

function relImport(fromFile, distRel, isTypeFile) {
  const target = join(DIST, distRel);
  let rel = relative(dirname(fromFile), target);
  if (!rel.startsWith('.')) rel = './' + rel;
  // .d.ts files import without an extension (TS module resolution).
  if (isTypeFile) rel = rel.replace(/\.js$/, '');
  return rel;
}

async function rewriteImports(filePath) {
  const original = await readFile(filePath, 'utf8');
  const isTypeFile = filePath.endsWith('.d.ts');

  let rewritten = original.replace(
    /(['"])(@hono-preact\/(?:iso\/internal\/runtime|iso\/internal|iso\/page|iso\/signals|iso|server\/internal\/runtime|server\/internal\/cloudflare|server|vite\/adapter-cloudflare|vite\/adapter-node|vite))(['"])/g,
    (match, q1, source, q2) => {
      const distRel = DIST_PATHS[source];
      if (!distRel) return match;
      return `${q1}${relImport(filePath, distRel, isTypeFile)}${q2}`;
    }
  );

  // Drop stale sourcemap pointers since we don't copy the .map files.
  rewritten = rewritten.replace(/\n?\/\/# sourceMappingURL=[^\n]*\n?/g, '\n');

  if (rewritten !== original) await writeFile(filePath, rewritten);
}

async function main() {
  for (const pkg of SUBPACKAGES) {
    if (!existsSync(pkg.src)) {
      throw new Error(
        `Workspace package dist missing: ${pkg.src}. Run \`pnpm --filter @hono-preact/${pkg.name} build\` first.`
      );
    }
    if (existsSync(pkg.dest)) await rm(pkg.dest, { recursive: true });
    await copyTree(pkg.src, pkg.dest);
  }

  await walk(DIST, async (file) => {
    if (file.endsWith('.js') || file.endsWith('.d.ts')) {
      await rewriteImports(file);
    }
  });

  console.log(
    `consolidated ${SUBPACKAGES.map((p) => '@hono-preact/' + p.name).join(', ')} into hono-preact/dist/`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
