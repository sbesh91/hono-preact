import { describe, it, expect } from 'vitest';
import {
  parseOtp,
  buildPublishArgs,
  otpFailureHint,
  verifyPublished,
  missingAfterPublishMessage,
} from '../release-args.mjs';

// These back the 2FA path of `pnpm release` / `pnpm release:ui`, which is run
// by hand a few times a year and cannot be rehearsed against the real registry:
// a wrong argument list is discovered mid-release, against a version number
// that is already committed and tagged. So the argument handling is unit-tested
// even though the drivers around it are not.

describe('parseOtp', () => {
  it('reads both spellings', () => {
    expect(parseOtp(['--otp', '123456'])).toBe('123456');
    expect(parseOtp(['--otp=123456'])).toBe('123456');
  });

  it('finds the flag among other arguments', () => {
    expect(parseOtp(['--skip-tag', '--otp', '123456'])).toBe('123456');
    expect(parseOtp(['--otp=123456', '--dry-run'])).toBe('123456');
  });

  it('returns null when absent', () => {
    expect(parseOtp([])).toBeNull();
    expect(parseOtp(['--dry-run', '--skip-tag'])).toBeNull();
  });

  it('throws rather than swallowing a following flag as the code', () => {
    // The whole point of the option is that a publish without the code fails
    // confusingly. Consuming `--dry-run` as an OTP would publish for real with
    // a junk code, which is worse than either intent.
    expect(() => parseOtp(['--otp', '--dry-run'])).toThrow(/needs a value/);
    expect(() => parseOtp(['--otp'])).toThrow(/needs a value/);
    expect(() => parseOtp(['--otp='])).toThrow(/needs a value/);
  });

  it('accepts a recovery code, which is not six digits', () => {
    // npm recovery codes are alphanumeric; validating "six digits" here would
    // reject a legitimate second factor.
    expect(parseOtp(['--otp=abcd-efgh'])).toBe('abcd-efgh');
  });
});

describe('buildPublishArgs', () => {
  it('publishes public, without git checks, by default', () => {
    expect(buildPublishArgs()).toEqual([
      'publish',
      '--access',
      'public',
      '--no-git-checks',
    ]);
  });

  it('appends --dry-run and --otp when asked', () => {
    expect(buildPublishArgs({ dryRun: true, otp: '123456' })).toEqual([
      'publish',
      '--access',
      'public',
      '--no-git-checks',
      '--dry-run',
      '--otp',
      '123456',
    ]);
  });

  it('omits --otp entirely when there is no code', () => {
    // `--otp` with an empty value is rejected by pnpm, so a falsy code must not
    // reach the argument list at all.
    expect(buildPublishArgs({ otp: null })).not.toContain('--otp');
    expect(buildPublishArgs({ otp: '' })).not.toContain('--otp');
  });
});

describe('otpFailureHint', () => {
  it('names the 404 symptom and the command that fixes it', () => {
    const hint = otpFailureHint('pnpm release');
    expect(hint).toMatch(/404/);
    expect(hint).toMatch(/pnpm release -- --otp=123456/);
  });

  it('names the caller\'s own command, not the framework one', () => {
    // release-ui.mjs prints this too. Sending a stuck ui-release operator at
    // `pnpm release` would point them at the wrong package.
    const hint = otpFailureHint('pnpm release:ui');
    expect(hint).toMatch(/pnpm release:ui -- --otp=123456/);
    expect(hint).not.toMatch(/\bpnpm release --/);
  });
});

describe('verifyPublished', () => {
  /** A probe that reports "not there" until the nth call. */
  const landsOnCall = (n) => {
    let calls = 0;
    return () => ++calls >= n;
  };

  it('accepts a version that is already visible, without waiting', () => {
    const sleeps = [];
    expect(
      verifyPublished({
        isPublished: () => true,
        sleep: (ms) => sleeps.push(ms),
      })
    ).toBe(true);
    expect(sleeps).toEqual([]);
  });

  it('retries while the version propagates', () => {
    const sleeps = [];
    expect(
      verifyPublished({
        isPublished: landsOnCall(3),
        sleep: (ms) => sleeps.push(ms),
        delayMs: 1000,
      })
    ).toBe(true);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('gives up after the configured attempts', () => {
    let probes = 0;
    const sleeps = [];
    expect(
      verifyPublished({
        isPublished: () => {
          probes++;
          return false;
        },
        sleep: (ms) => sleeps.push(ms),
        attempts: 4,
        delayMs: 500,
      })
    ).toBe(false);
    expect(probes).toBe(4);
    // No sleep after the final probe: nothing would read the result, and the
    // operator is already waiting on a failed release.
    expect(sleeps).toEqual([500, 500, 500]);
  });

  it('probes once when told to try once', () => {
    let probes = 0;
    const sleeps = [];
    verifyPublished({
      isPublished: () => {
        probes++;
        return false;
      },
      sleep: (ms) => sleeps.push(ms),
      attempts: 1,
    });
    expect(probes).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe('missingAfterPublishMessage', () => {
  it('names the package, says nothing was tagged, and points at npm', () => {
    const msg = missingAfterPublishMessage(
      'hono-preact',
      '0.14.0',
      'packages/hono-preact'
    );
    expect(msg).toMatch(/hono-preact@0\.14\.0/);
    expect(msg).toMatch(/not on the registry/);
    // The two facts that make the failure actionable: the tag has not gone out,
    // and pnpm is the thing that lied.
    expect(msg).toMatch(/Nothing has been tagged/);
    expect(msg).toMatch(/npm publish/);
  });

  it('prints a command that can be run as-is', () => {
    // Reconstructing the right directory is not something to ask of someone
    // mid-failed-release, and the ui package does not live where a reader
    // would guess from the package name.
    const msg = missingAfterPublishMessage(
      'hono-preact-ui',
      '0.5.0',
      'packages/ui'
    );
    expect(msg).toMatch(/cd packages\/ui && npm publish/);
    expect(msg).not.toMatch(/packages\/\.\.\./);
  });
});
