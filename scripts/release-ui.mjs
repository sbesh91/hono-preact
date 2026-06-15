#!/usr/bin/env node
// Independent release driver for hono-preact-ui.
//
// ui is a standalone library that versions on its own line (it is NOT part of
// the hono-preact umbrella and does not track the framework version), so it has
// its own one-shot driver and its own tag namespace (`hono-preact-ui@x.y.z`).
// Run this alongside `pnpm release` when both ship in the same cycle; keeping it
// a separate command is deliberate, so the two version lines never re-couple.
//
// Usage:
//   node scripts/release-ui.mjs --dry-run    # preview, no upload, no tag
//   node scripts/release-ui.mjs              # real publish + tag
//   node scripts/release-ui.mjs --skip-tag   # publish only (e.g. re-running after partial failure)
//
// Idempotency: if the version is already on the npm registry, the publish is
// skipped with a note. Lets you re-run after a partial failure.

import { execSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipTag = args.has('--skip-tag');

const readPkg = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const pkgDir = 'packages/ui';
const pkg = readPkg(`${pkgDir}/package.json`);
const { name, version } = pkg;

if (pkg.private) {
  console.error(`Release blocked — ${name} is still marked "private". Remove it before publishing.`);
  process.exit(1);
}

const [major, minor] = version.split('.');

console.log(`Releasing ${name}@${version}${dryRun ? ' (dry-run)' : ''}`);

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

publish(name, pkgDir);

const tagName = `${name}@${version}`;
if (dryRun) {
  console.log(`Dry-run: would tag ${tagName} and push.`);
} else if (skipTag) {
  console.log(`Skipping tag (--skip-tag). Tag manually with: git tag '${tagName}' && git push origin '${tagName}'`);
} else {
  console.log(`Tagging ${tagName}...`);
  const tagResult = spawnSync('git', ['tag', tagName], { cwd: ROOT, stdio: 'inherit' });
  if (tagResult.status !== 0) {
    console.error(`git tag ${tagName} failed. Tag may already exist; push it with: git push origin '${tagName}'`);
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
    // Anchored to ui's own notes shape: `<date>-ui-vX.Y-release-notes.md`.
    // Mirrors the umbrella's matcher in release.mjs so neither script can grab
    // the other's notes file (see the note there).
    const notesRe = new RegExp(
      `^\\d{4}-\\d{2}-\\d{2}-ui-v${major}\\.${minor}-release-notes\\.md$`,
    );
    const match = readdirSync(specsDir).find((f) => notesRe.test(f));
    return match ? `docs/superpowers/specs/${match}` : null;
  } catch {
    return null;
  }
};

const notes = findReleaseNotes();
console.log('');
console.log(`Released ${name}@${version}. Create the GitHub release:`);
// --latest=false is REQUIRED, not optional: `gh release create` defaults to
// "automatic" latest (newest by date wins), so omitting the flag lets a ui
// release steal the repo's "latest" badge from the framework. Force it off.
if (notes) {
  console.log(`  gh release create '${tagName}' -F ${notes} --title '${name}@${version}' --latest=false`);
} else {
  console.log(`  gh release create '${tagName}' -F <path-to-release-notes.md> --title '${name}@${version}' --latest=false`);
  console.log(`  (no release notes file found in docs/superpowers/specs/ matching ui-v${major}.${minor})`);
}
