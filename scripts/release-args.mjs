// Shared argument handling for the two release drivers (release.mjs,
// release-ui.mjs).
//
// It lives in its own module because both drivers publish on import: a test
// that imported either one to reach these helpers would run a real release.
// Keeping the parsing here is what makes it testable at all.

/**
 * Read `--otp` out of an argv slice, accepting `--otp=123456` and
 * `--otp 123456`.
 *
 * Throws on `--otp` with no value rather than returning null. Silently
 * publishing without the one-time password is the failure this option exists to
 * prevent, and npm answers an un-OTP'd write to an existing package with a bare
 * `404 Not Found - PUT`, which reads as "the package is gone" rather than "your
 * second factor is missing".
 *
 * @param {string[]} argv - `process.argv.slice(2)`
 * @returns {string | null} the code, or null when `--otp` was not passed
 */
export function parseOtp(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--otp') {
      const value = argv[i + 1];
      // A following flag is a missing value, not a code: `--otp --dry-run`
      // would otherwise publish with the literal string '--dry-run'.
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--otp needs a value, e.g. --otp 123456');
      }
      return value;
    }
    if (arg.startsWith('--otp=')) {
      const value = arg.slice('--otp='.length);
      if (value === '') {
        throw new Error('--otp needs a value, e.g. --otp=123456');
      }
      return value;
    }
  }
  return null;
}

/**
 * Build the `pnpm publish` argument list.
 *
 * @param {{ dryRun?: boolean, otp?: string | null }} opts
 * @returns {string[]}
 */
export function buildPublishArgs({ dryRun = false, otp = null } = {}) {
  const args = ['publish', '--access', 'public', '--no-git-checks'];
  if (dryRun) args.push('--dry-run');
  if (otp) args.push('--otp', otp);
  return args;
}

/**
 * A hint to print when a publish fails, naming the cause that is not legible
 * from npm's own response.
 *
 * Takes the driver's own command because the two drivers are separate entry
 * points: telling someone whose `pnpm release:ui` just failed to re-run
 * `pnpm release` would send them at the wrong package, at the moment they are
 * least able to spot it.
 *
 * `pnpm publish` wraps its request in OTP handling, but that only triggers on
 * npm's `401 EOTP` challenge. An account with two-factor auth set to
 * `auth-and-writes` publishing with a web-login session token gets a flat 404
 * instead, so pnpm never prompts and the operator sees a "not found" for a
 * package that plainly exists.
 *
 * @param {string} command - the driver's own command, e.g. `pnpm release:ui`
 * @returns {string}
 */
export function otpFailureHint(command) {
  return [
    '',
    'If that was a 404 on the PUT for a package that exists, the write was most',
    'likely rejected for a missing one-time password rather than a missing',
    'package. Check `npm profile get` for "two-factor auth: auth-and-writes",',
    'then re-run with an OTP:',
    '',
    `  ${command} -- --otp=123456`,
    '',
    '(`pnpm publish` only prompts when npm answers 401 EOTP; a 404 it cannot',
    'interpret, so the code has to be passed in.)',
  ].join('\n');
}

/**
 * Block for `ms` without going async.
 *
 * The release drivers are synchronous end to end (spawnSync/execSync);
 * restructuring them around promises just to wait between registry probes would
 * be a much larger change than the wait is worth. `Atomics.wait` on the main
 * thread is permitted in Node (unlike browsers).
 *
 * @param {number} ms
 */
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Classify one `npm view <pkg>@<version> version` result.
 *
 * Three outcomes, not two. "The registry says this version does not exist" and
 * "the registry could not be reached" look identical through a boolean, and
 * conflating them is how a transient 5xx or DNS blip turns a perfectly good
 * publish into a failed release whose suggested remedy (publish again) fails
 * with EPUBLISHCONFLICT.
 *
 * @param {{status: number|null, stdout: string, stderr: string, version: string}} r
 * @returns {'published' | 'absent' | 'unknown'}
 */
export function classifyViewResult({ status, stdout, stderr, version }) {
  if (status === 0) return stdout.trim() === version ? 'published' : 'absent';
  // npm reports a missing package/version as E404. Anything else (ENOTFOUND,
  // ETIMEDOUT, EAI_AGAIN, a 5xx, a proxy refusing) is "we did not get an
  // answer", which is not evidence of absence.
  return /E404|404 Not Found/.test(stderr) ? 'absent' : 'unknown';
}

/**
 * Confirm a version actually reached the registry, retrying while it
 * propagates or while the registry is unreachable.
 *
 * `pnpm publish` can exit 0 having uploaded nothing. That is not theoretical:
 * on the v0.14.0 cut it silently no-op'd for two of the three packages while
 * reporting success, so the driver went on to publish the scaffolder and push
 * both tags. For a while `npm create hono-preact@latest` was broken on the
 * registry, because the published scaffolder pinned a `hono-preact` version
 * that did not exist.
 *
 * So the exit code is not evidence. The registry is. This runs BEFORE tagging,
 * which is what keeps a tag (and the docs deploy it triggers) from being
 * created for a release that did not happen.
 *
 * IO is injected so the retry policy is testable without publishing anything or
 * waiting in real time.
 *
 * @param {object} opts
 * @param {() => 'published' | 'absent' | 'unknown'} opts.probe
 * @param {(ms: number) => void} opts.sleep
 * @param {number} [opts.attempts] - total probes, including the first
 * @param {number} [opts.delayMs] - wait between probes
 * @returns {'published' | 'absent' | 'unknown'} the last verdict reached
 */
export function verifyPublished({
  probe,
  sleep,
  attempts = 5,
  delayMs = 3000,
}) {
  let last = 'unknown';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = probe();
    if (last === 'published') return last;
    // No sleep after the final probe: nothing would read the result.
    if (attempt < attempts) sleep(delayMs);
  }
  return last;
}

/**
 * What to print when the registry positively reports the version as absent:
 * the publish claimed success and uploaded nothing.
 *
 * @param {string} name
 * @param {string} version
 * @param {string} pkgDir - repo-relative package directory, so the suggested
 *   command is runnable as printed rather than needing to be reconstructed
 *   by someone in the middle of a failed release
 * @returns {string}
 */
export function missingAfterPublishMessage(name, version, pkgDir) {
  return [
    `${name}@${version} reported a successful publish but is not on the registry.`,
    '',
    '`pnpm publish` can exit 0 without uploading anything, so its exit code is',
    'not proof. Nothing has been tagged: fix the publish first, with npm rather',
    'than pnpm, then re-run this script (already-published packages are skipped):',
    '',
    `  cd ${pkgDir} && npm publish --access public --otp=<code>`,
    '',
    `Confirm with: npm view ${name} version`,
  ].join('\n');
}

/**
 * What to print when the registry could not be reached at all.
 *
 * Deliberately different advice from the absent case: the publish may well have
 * succeeded, so "publish again" is the wrong instinct. It would fail with
 * EPUBLISHCONFLICT at best, and at worst send someone chasing a problem that
 * does not exist.
 *
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
export function unconfirmedAfterPublishMessage(name, version) {
  return [
    `Could not reach the registry to confirm ${name}@${version}.`,
    '',
    'The publish may have succeeded. Nothing has been tagged, and nothing has',
    'been re-published: check by hand before doing either.',
    '',
    `  npm view ${name} version`,
    '',
    'If it shows the new version, the publish worked and this script can be',
    're-run (it skips what is already published). If it does not, publish with',
    'npm rather than pnpm.',
  ].join('\n');
}
