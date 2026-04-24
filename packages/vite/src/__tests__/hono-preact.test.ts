import { describe, it, expect } from 'vitest';
import { honoPreact } from '../hono-preact.js';

function getClientConfig(plugins: ReturnType<typeof honoPreact>, userConfig = {}) {
  const configPlugin = plugins.find(
    (p) => 'config' in p && typeof p.config === 'function'
  );
  if (!configPlugin || typeof configPlugin.config !== 'function') {
    throw new Error('config plugin not found');
  }
  const configFn = configPlugin.config as (config: unknown, env: unknown) => unknown;
  return configFn(userConfig, { mode: 'client', command: 'build' });
}

describe('honoPreact rollupOptions merge', () => {
  it('uses framework defaults when no clientBuild.rollupOptions provided', () => {
    const plugins = honoPreact({ entry: './src/server.tsx' });
    const config = getClientConfig(plugins);
    expect(config).toBeTruthy();
    const rollup = (config as { build: { rollupOptions: { input: string[]; output: { entryFileNames: string } } } }).build.rollupOptions;
    expect(rollup.input).toEqual(['./src/client.tsx']);
    expect(rollup.output.entryFileNames).toBe('static/client.js');
  });

  it('merges user output fields without losing framework defaults', () => {
    const plugins = honoPreact({
      entry: './src/server.tsx',
      clientBuild: {
        rollupOptions: {
          output: { entryFileNames: 'custom/entry.js' },
        },
      },
    });
    const config = getClientConfig(plugins);
    const rollup = (config as { build: { rollupOptions: { output: { entryFileNames: string; chunkFileNames: string } } } }).build.rollupOptions;
    expect(rollup.output.entryFileNames).toBe('custom/entry.js');
    expect(rollup.output.chunkFileNames).toBe('static/[name]-[hash].js');
  });

  it('ignores array-form output and keeps framework defaults', () => {
    const plugins = honoPreact({
      entry: './src/server.tsx',
      clientBuild: {
        rollupOptions: {
          output: [{ entryFileNames: 'ignored.js' }],
        },
      },
    });
    const config = getClientConfig(plugins);
    const rollup = (config as { build: { rollupOptions: { output: { entryFileNames: string } } } }).build.rollupOptions;
    expect(rollup.output.entryFileNames).toBe('static/client.js');
  });
});
