import { describe, it, expect } from 'vitest';
import {
  parseOtp,
  buildPublishArgs,
  otpFailureHint,
  classifyViewResult,
  verifyPublished,
  missingAfterPublishMessage,
  unconfirmedAfterPublishMessage,
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

describe('classifyViewResult', () => {
  it('reads a matching version as published', () => {
    expect(
      classifyViewResult({
        status: 0,
        stdout: '0.14.0\n',
        stderr: '',
        version: '0.14.0',
      })
    ).toBe('published');
  });

  it('reads npm E404 as a definite absence', () => {
    expect(
      classifyViewResult({
        status: 1,
        stdout: '',
        stderr: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/hono-preact",
        version: '0.14.0',
      })
    ).toBe('absent');
  });

  it.each([
    ['DNS failure', 'npm error code ENOTFOUND\nnpm error network getaddrinfo'],
    ['timeout', 'npm error code ETIMEDOUT'],
    ['registry 503', 'npm error 503 Service Unavailable'],
    ['transient DNS', 'npm error code EAI_AGAIN'],
  ])('reads %s as unknown, not absent', (_label, stderr) => {
    // The distinction this whole tri-state exists for: an unreachable registry
    // is not evidence that a publish failed, and treating it as such would
    // fail a good release and tell the operator to publish again, which would
    // then fail with EPUBLISHCONFLICT.
    expect(
      classifyViewResult({ status: 1, stdout: '', stderr, version: '0.14.0' })
    ).toBe('unknown');
  });

  it('reads a mismatched version as absent', () => {
    expect(
      classifyViewResult({
        status: 0,
        stdout: '0.13.1',
        stderr: '',
        version: '0.14.0',
      })
    ).toBe('absent');
  });
});

describe('verifyPublished', () => {
  /** A probe returning the given verdicts in order, repeating the last. */
  const scripted = (...verdicts) => {
    let i = 0;
    return () => verdicts[Math.min(i++, verdicts.length - 1)];
  };

  it('accepts a version that is already visible, without waiting', () => {
    const sleeps = [];
    expect(
      verifyPublished({ probe: () => 'published', sleep: (ms) => sleeps.push(ms) })
    ).toBe('published');
    expect(sleeps).toEqual([]);
  });

  it('retries while the version propagates', () => {
    const sleeps = [];
    expect(
      verifyPublished({
        probe: scripted('absent', 'absent', 'published'),
        sleep: (ms) => sleeps.push(ms),
        delayMs: 1000,
      })
    ).toBe('published');
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('retries through an unreachable registry and accepts a later answer', () => {
    expect(
      verifyPublished({
        probe: scripted('unknown', 'unknown', 'published'),
        sleep: () => {},
      })
    ).toBe('published');
  });

  it('reports absent when the registry keeps saying so', () => {
    expect(
      verifyPublished({ probe: () => 'absent', sleep: () => {}, attempts: 3 })
    ).toBe('absent');
  });

  it('reports unknown when the registry never answers', () => {
    // Must NOT collapse to 'absent': the caller prints different advice, and
    // telling someone to re-publish a package that did publish is worse than
    // telling them to go look.
    expect(
      verifyPublished({ probe: () => 'unknown', sleep: () => {}, attempts: 3 })
    ).toBe('unknown');
  });

  it('gives up after the configured attempts, without a trailing sleep', () => {
    let probes = 0;
    const sleeps = [];
    verifyPublished({
      probe: () => {
        probes++;
        return 'absent';
      },
      sleep: (ms) => sleeps.push(ms),
      attempts: 4,
      delayMs: 500,
    });
    expect(probes).toBe(4);
    expect(sleeps).toEqual([500, 500, 500]);
  });

  it('pins the production defaults', () => {
    // Every other case passes explicit values, so without this the defaults --
    // the only configuration a real release actually uses -- could be changed
    // to 1 attempt (or 0, which probes nothing) with the suite still green.
    let probes = 0;
    const sleeps = [];
    verifyPublished({
      probe: () => {
        probes++;
        return 'absent';
      },
      sleep: (ms) => sleeps.push(ms),
    });
    expect(probes).toBe(5);
    expect(sleeps).toEqual([3000, 3000, 3000, 3000]);
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
    expect(msg).toMatch(/Nothing has been tagged/);
    expect(msg).toMatch(/npm publish/);
  });

  it('prints a command that can be run as-is', () => {
    const msg = missingAfterPublishMessage(
      'hono-preact-ui',
      '0.5.0',
      'packages/ui'
    );
    expect(msg).toMatch(/cd packages\/ui && npm publish/);
    expect(msg).not.toMatch(/packages\/\.\.\./);
  });
});

describe('unconfirmedAfterPublishMessage', () => {
  it('does not tell the operator to re-publish', () => {
    const msg = unconfirmedAfterPublishMessage('hono-preact', '0.14.0');
    expect(msg).toMatch(/Could not reach the registry/);
    expect(msg).toMatch(/may have succeeded/);
    expect(msg).toMatch(/npm view hono-preact version/);
    // The absent-case remedy would be actively wrong here.
    expect(msg).not.toMatch(/cd packages/);
  });
});
