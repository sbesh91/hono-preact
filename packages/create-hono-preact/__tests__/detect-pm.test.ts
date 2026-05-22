import { describe, it, expect } from 'vitest';
import { detectPackageManager } from '../lib/detect-pm.mjs';

describe('detectPackageManager', () => {
  it('returns npm when user-agent starts with npm/', () => {
    expect(
      detectPackageManager({
        npm_config_user_agent: 'npm/10.2.5 node/v20.10.0 darwin arm64',
      })
    ).toBe('npm');
  });

  it('returns pnpm when user-agent starts with pnpm/', () => {
    expect(
      detectPackageManager({
        npm_config_user_agent: 'pnpm/10.18.3 npm/? node/v20.10.0 darwin arm64',
      })
    ).toBe('pnpm');
  });

  it('returns yarn when user-agent starts with yarn/', () => {
    expect(
      detectPackageManager({
        npm_config_user_agent: 'yarn/4.2.2 npm/? node/v20.10.0 darwin arm64',
      })
    ).toBe('yarn');
  });

  it('returns bun when user-agent starts with bun/', () => {
    expect(
      detectPackageManager({
        npm_config_user_agent: 'bun/1.0.30 npm/? node/v20.10.0 darwin arm64',
      })
    ).toBe('bun');
  });

  it('defaults to pnpm when env is empty', () => {
    expect(detectPackageManager({})).toBe('pnpm');
  });

  it('defaults to pnpm when user-agent is unrecognised', () => {
    expect(
      detectPackageManager({ npm_config_user_agent: 'something-weird/1.0' })
    ).toBe('pnpm');
  });
});
