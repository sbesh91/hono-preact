// Trims the published `hono-preact` manifest at pack time.
//
// The package declares devDependencies on the three workspace-private packages
// (@hono-preact/iso, @hono-preact/server, @hono-preact/vite) so local `tsc`
// resolves them. consolidate.mjs bundles their dist/ into hono-preact/dist/,
// so they are never published, and an install of the tarball must not try to
// resolve `workspace:*` (or any) specs that only exist inside this monorepo.
//
// Runs as pack lifecycle hooks:
//   prepack  -> back up package.json, rewrite it with the stripped manifest
//   postpack -> restore package.json from the backup, remove the backup
//
// The backup is the source of truth for the original manifest. A leftover
// backup means a prior pack was interrupted before postpack ran, so prepack
// refuses to run: re-deriving the stripped manifest from a stale backup (and
// letting postpack restore it) could silently revert a version bump on the
// release path. The operator must restore package.json (run the postpack step)
// or delete the stale backup first. postpack's restore is unconditional
// whenever a backup exists.

import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url));
const BACKUP = fileURLToPath(new URL('../package.json.bak', import.meta.url));

// Workspace-private packages bundled into dist/; never published, so they must
// not appear as dependencies of the published tarball. Matched by key, so the
// strip is agnostic to the spec form (`workspace:*`, a pinned version, etc.).
const UNPUBLISHED_DEV_DEPS = [
  '@hono-preact/iso',
  '@hono-preact/server',
  '@hono-preact/vite',
];

/**
 * Return a shallow clone of `manifest` with the workspace-private
 * devDependencies removed. Pure: never mutates its argument or any nested
 * object it holds.
 *
 * @param {Record<string, unknown>} manifest
 */
export function stripUnpublishedDevDeps(manifest) {
  if (!manifest.devDependencies) return { ...manifest };
  const devDependencies = { ...manifest.devDependencies };
  for (const name of UNPUBLISHED_DEV_DEPS) delete devDependencies[name];
  return { ...manifest, devDependencies };
}

async function prepack() {
  // A leftover backup means a prior pack was interrupted before postpack ran.
  // Its package.json may already be the stripped variant, so re-deriving from
  // the stale backup (which postpack would then restore) could silently revert
  // a version bump. Fail loudly and make the operator reconcile first.
  if (existsSync(BACKUP)) {
    throw new Error(
      'package.json.bak already exists (interrupted pack?). Restore package.json (run the postpack step) or delete the stale backup before packing.'
    );
  }
  const current = await readFile(MANIFEST, 'utf8');
  await writeFile(BACKUP, current);
  const stripped = stripUnpublishedDevDeps(JSON.parse(current));
  // 2-space indent + trailing newline matches Prettier's JSON output, so the
  // published package.json stays format-clean.
  await writeFile(MANIFEST, JSON.stringify(stripped, null, 2) + '\n');
}

async function postpack() {
  if (!existsSync(BACKUP)) return;
  const original = await readFile(BACKUP, 'utf8');
  await writeFile(MANIFEST, original);
  await rm(BACKUP);
}

// Run the CLI only when invoked directly (`node scripts/publish-manifest.mjs
// <command>`), never when imported by the unit test, whose `process.argv`
// would otherwise be misread as a command.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const command = process.argv[2];
  if (command === 'prepack') {
    await prepack();
  } else if (command === 'postpack') {
    await postpack();
  } else {
    console.error(`publish-manifest: expected "prepack" or "postpack"`);
    process.exit(1);
  }
}
