#!/usr/bin/env node
// One-shot release driver. Reads version from packages/hono-preact/package.json,
// sanity-checks that create-hono-preact and the template pins agree, then
// publishes hono-preact first, create-hono-preact second, and tags.
//
// Usage:
//   node scripts/release.mjs --dry-run    # preview, no upload, no tag
//   node scripts/release.mjs              # real publish + tag
//   node scripts/release.mjs --skip-tag   # publish only (e.g. re-running after partial failure)
//   node scripts/release.mjs --otp 123456  # supply a 2FA one-time password
//
// 2FA: an account with two-factor auth set to `auth-and-writes` must pass
// `--otp`. `pnpm publish` prompts only when npm answers `401 EOTP`; a
// web-login session token gets a bare `404 Not Found - PUT` instead, which
// pnpm cannot interpret, so the code has to come in on the command line:
//   pnpm release -- --otp=123456
//
// Verification: a publish that reports success is confirmed against the
// registry before anything is tagged. `pnpm publish` can exit 0 having
// uploaded nothing, so its exit code is not evidence.
//
// Idempotency: if a version is already on the npm registry, that publish is
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

const readPkg = (rel) =>
  JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const framework = readPkg('packages/hono-preact/package.json');
const cli = readPkg('packages/create-hono-preact/package.json');
// The hono-preact pin lives once in the base template fragment; the adapter
// and feature overlays do not carry it. (The scaffolder deep-merges fragments.)
const tplBase = readPkg(
  'packages/create-hono-preact/templates/base/package.json'
);

const version = framework.version;
const [major, minor] = version.split('.');
const expectedPin = `^${major}.${minor}.0`;

const errors = [];
if (cli.version !== version) {
  errors.push(`create-hono-preact version ${cli.version} != hono-preact ${version}`);
}
if (tplBase.dependencies['hono-preact'] !== expectedPin) {
  errors.push(`templates/base hono-preact pin ${tplBase.dependencies['hono-preact']} != ${expectedPin}`);
}
if (errors.length) {
  console.error('Release blocked — fix version mismatches first:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(`Releasing v${version}${dryRun ? ' (dry-run)' : ''}`);

// Synchronous sleep. The driver is sync end to end (spawnSync/execSync), and
// going async just to wait between registry probes would restructure it.
const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

// `--prefer-online` on BOTH uses, not just the post-publish check. A stale
// packument in npm's cache would otherwise make the skip path report a version
// as already published when it is not, which skips the publish AND the
// verification below and then tags: the exact failure this guard exists to
// stop, arrived at from the other side. A release runs a few times a year, so
// the extra round trip costs nothing worth counting.
const alreadyPublished = (name, ver) => {
  try {
    const out = execSync(`npm view ${name}@${ver} version --prefer-online`, {
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
      isPublished: () => alreadyPublished(name, version),
      sleep: sleepSync,
    });
    if (!landed) {
      console.error('');
      console.error(missingAfterPublishMessage(name, version, pkgDir));
      process.exit(1);
    }
    console.log(`  ${name}@${version} confirmed on the registry`);
  }
  if (result.status !== 0) {
    console.error(`  ${name} publish failed (exit ${result.status})`);
    if (!otp) console.error(otpFailureHint('pnpm release'));
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
