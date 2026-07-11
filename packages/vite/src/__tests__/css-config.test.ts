import { describe, it, expect } from 'vitest';
import type { Plugin, UserConfig } from 'vite';
import { honoPreact } from '../hono-preact.js';
import { BASELINE_TARGETS } from '../css-targets.js';
import type { HonoPreactAdapter } from '../adapter.js';

const stubAdapter: HonoPreactAdapter = {
  name: 'stub',
  vitePlugins: () => [],
  wrapEntry: () => '',
};

function configResult(userConfig: UserConfig): UserConfig {
  const plugins = honoPreact({ adapter: stubAdapter });
  const config = plugins.find(
    (p): p is Plugin => p.name === 'hono-preact:config'
  );
  if (!config || typeof config.config !== 'function') {
    throw new Error('hono-preact:config plugin with a config() fn expected');
  }
  const result = config.config.call(
    // Plugin context is unused by this hook.
    undefined as never,
    userConfig,
    { command: 'build', mode: 'production' }
  );
  if (!result || typeof result !== 'object')
    throw new Error('expected a partial config');
  if (result instanceof Promise) {
    throw new Error('expected a synchronous config() result');
  }
  return result;
}

describe('framework CSS pipeline defaults', () => {
  it('opts the build into lightningcss minification with Baseline targets', () => {
    const result = configResult({});
    expect(result.build?.cssMinify).toBe('lightningcss');
    expect(result.css?.lightningcss?.targets).toEqual(BASELINE_TARGETS);
  });

  it('respects a user-configured cssMinify', () => {
    const result = configResult({ build: { cssMinify: 'esbuild' } });
    expect(result.build?.cssMinify).toBeUndefined();
  });

  it('respects user-configured lightningcss options', () => {
    const result = configResult({
      css: { lightningcss: { targets: { chrome: 100 << 16 } } },
    });
    expect(result.css).toBeUndefined();
  });

  it('encodes plausible Baseline Widely Available versions', () => {
    // Sanity floor: all majors >= the late-2023 releases.
    expect(BASELINE_TARGETS.chrome).toBeGreaterThanOrEqual(120 << 16);
    expect(BASELINE_TARGETS.safari).toBeGreaterThanOrEqual(
      (17 << 16) | (2 << 8)
    );
  });
});
