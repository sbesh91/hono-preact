#!/usr/bin/env node
// One-shot release driver. Reads version from packages/hono-preact/package.json,
// sanity-checks that create-hono-preact and the template pins agree, then
// publishes hono-preact first, create-hono-preact second, and tags.
//
// Usage:
//   node scripts/release.mjs --dry-run    # preview, no upload, no tag
//   node scripts/release.mjs              # real publish + tag
//   node scripts/release.mjs --skip-tag   # publish only (e.g. re-running after partial failure)
//
// Idempotency: if a version is already on the npm registry, that publish is
// skipped with a note. Lets you re-run after a partial failure.

import { execSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipTag = args.has('--skip-tag');

const readPkg = (rel) =>
  JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const framework = readPkg('packages/hono-preact/package.json');
const cli = readPkg('packages/create-hono-preact/package.json');
const tplCf = readPkg('packages/create-hono-preact/templates/cloudflare/package.json');
const tplNode = readPkg('packages/create-hono-preact/templates/node/package.json');

const version = framework.version;
const [major, minor] = version.split('.');
const expectedPin = `^${major}.${minor}.0`;

const errors = [];
if (cli.version !== version) {
  errors.push(`create-hono-preact version ${cli.version} != hono-preact ${version}`);
}
if (tplCf.dependencies['hono-preact'] !== expectedPin) {
  errors.push(`templates/cloudflare hono-preact pin ${tplCf.dependencies['hono-preact']} != ${expectedPin}`);
}
if (tplNode.dependencies['hono-preact'] !== expectedPin) {
  errors.push(`templates/node hono-preact pin ${tplNode.dependencies['hono-preact']} != ${expectedPin}`);
}
if (errors.length) {
  console.error('Release blocked — fix version mismatches first:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(`Releasing v${version}${dryRun ? ' (dry-run)' : ''}`);

const alreadyPublished = (name, ver) => {
  try {
    const out = execSync(`npm view ${name}@${ver} version`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out === ver;
  } catch {
    return false;
  }
};

const publish = (name, pkgDir) => {
  if (alreadyPublished(name, version)) {
    console.log(`  ${name}@${version} already on registry, skipping`);
    return;
  }
  console.log(`  publishing ${name}@${version}...`);
  const pnpmArgs = ['publish', '--access', 'public', '--no-git-checks'];
  if (dryRun) pnpmArgs.push('--dry-run');
  const result = spawnSync('pnpm', pnpmArgs, {
    cwd: join(ROOT, pkgDir),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`  ${name} publish failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
};

publish('hono-preact', 'packages/hono-preact');
publish('create-hono-preact', 'packages/create-hono-preact');

const tagName = `v${version}`;
if (dryRun) {
  console.log(`Dry-run: would tag ${tagName} and push.`);
} else if (skipTag) {
  console.log(`Skipping tag (--skip-tag). Tag manually with: git tag ${tagName} && git push origin ${tagName}`);
} else {
  console.log(`Tagging ${tagName}...`);
  const tagResult = spawnSync('git', ['tag', tagName], { cwd: ROOT, stdio: 'inherit' });
  if (tagResult.status !== 0) {
    console.error(`git tag ${tagName} failed. Tag may already exist; push it with: git push origin ${tagName}`);
    process.exit(tagResult.status ?? 1);
  }
  const pushResult = spawnSync('git', ['push', 'origin', tagName], { cwd: ROOT, stdio: 'inherit' });
  if (pushResult.status !== 0) {
    console.error(`git push origin ${tagName} failed. Push manually.`);
    process.exit(pushResult.status ?? 1);
  }
}

const findReleaseNotes = () => {
  const specsDir = join(ROOT, 'docs/superpowers/specs');
  try {
    // Match only the umbrella's own notes: `<date>-vX.Y-release-notes.md`.
    // Anchoring the version right after the date keeps this from grabbing a
    // scoped package's file (e.g. `<date>-ui-vX.Y-release-notes.md`), which a
    // bare `endsWith('vX.Y-release-notes.md')` would falsely match if the
    // framework and that package ever shared a major.minor.
    const notesRe = new RegExp(
      `^\\d{4}-\\d{2}-\\d{2}-v${major}\\.${minor}-release-notes\\.md$`,
    );
    const match = readdirSync(specsDir).find((f) => notesRe.test(f));
    return match ? `docs/superpowers/specs/${match}` : null;
  } catch {
    return null;
  }
};

const notes = findReleaseNotes();
console.log('');
console.log(`Released v${version}. Create the GitHub release:`);
if (notes) {
  console.log(`  gh release create ${tagName} -F ${notes} --latest`);
} else {
  console.log(`  gh release create ${tagName} -F <path-to-release-notes.md> --latest`);
  console.log(`  (no release notes file found in docs/superpowers/specs/ matching v${major}.${minor})`);
}
