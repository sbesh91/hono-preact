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
//   node scripts/release-ui.mjs --otp 123456  # supply a 2FA one-time password
//
// 2FA: an account with two-factor auth set to `auth-and-writes` must pass
// `--otp`. `pnpm publish` prompts only when npm answers `401 EOTP`; a
// web-login session token gets a bare `404 Not Found - PUT` instead, which
// pnpm cannot interpret, so the code has to come in on the command line:
//   pnpm release:ui -- --otp=123456
//
// Idempotency: if the version is already on the npm registry, the publish is
// skipped with a note. Lets you re-run after a partial failure.

import { execSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseOtp,
  buildPublishArgs,
  otpFailureHint,
  verifyPublished,
  missingAfterPublishMessage,
} from './release-args.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipTag = args.has('--skip-tag');
let otp;
try {
  otp = parseOtp(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const readPkg = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const pkgDir = 'packages/ui';
const pkg = readPkg(`${pkgDir}/package.json`);
const { name, version } = pkg;

if (pkg.private) {
  console.error(`Release blocked — ${name} is still marked "private". Remove it before publishing.`);
  process.exit(1);
}

const [major, minor] = version.split('.');

// The scaffolder's `--ui` overlay pins hono-preact-ui; gate the release so a ui
// version bump cannot ship while the template still points at the old pin.
const expectedPin = `^${major}.${minor}.0`;
const tplUi = readPkg(
  'packages/create-hono-preact/templates/feature/ui/package.json'
);
const uiPin = tplUi.dependencies?.['hono-preact-ui'];
if (uiPin !== expectedPin) {
  console.error(
    `Release blocked: templates/feature/ui hono-preact-ui pin ${uiPin} != ${expectedPin}. ` +
      `Update packages/create-hono-preact/templates/feature/ui/package.json.`
  );
  process.exit(1);
}

console.log(`Releasing ${name}@${version}${dryRun ? ' (dry-run)' : ''}`);

// Synchronous sleep. The driver is sync end to end (spawnSync/execSync), and
// going async just to wait between registry probes would restructure it.
const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const alreadyPublished = (name, ver, { preferOnline = false } = {}) => {
  try {
    const flag = preferOnline ? ' --prefer-online' : '';
    const out = execSync(`npm view ${name}@${ver} version${flag}`, {
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
  const pnpmArgs = buildPublishArgs({ dryRun, otp });
  const result = spawnSync('pnpm', pnpmArgs, {
    cwd: join(ROOT, pkgDir),
    stdio: 'inherit',
  });
  if (result.status === 0 && !dryRun) {
    // The exit code is not evidence; ask the registry. See verifyPublished.
    const landed = verifyPublished({
      isPublished: () => alreadyPublished(name, version, { preferOnline: true }),
      sleep: sleepSync,
    });
    if (!landed) {
      console.error('');
      console.error(missingAfterPublishMessage(name, version));
      process.exit(1);
    }
    console.log(`  ${name}@${version} confirmed on the registry`);
  }
  if (result.status !== 0) {
    console.error(`  ${name} publish failed (exit ${result.status})`);
    if (!otp) console.error(otpFailureHint('pnpm release:ui'));
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
