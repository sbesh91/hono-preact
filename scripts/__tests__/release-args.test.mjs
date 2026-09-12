import { describe, it, expect } from 'vitest';
import {
  parseOtp,
  buildPublishArgs,
  otpFailureHint,
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
