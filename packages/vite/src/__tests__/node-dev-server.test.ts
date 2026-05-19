import { describe, it, expect } from 'vitest';
import { nodeBuildPlugin, nodeDevServerPlugin } from '../node-dev-server.js';

const ctx = {
  root: '/p',
  coreAppModuleId: '/p/node_modules/.vite/hono-preact/core-app.tsx',
  entryWrapperId: '/p/node_modules/.vite/hono-preact/server-entry.tsx',
};

describe('nodeBuildPlugin', () => {
  it('configures client and ssr build environments', () => {
    const plugin = nodeBuildPlugin(ctx);
    const cfg = (plugin.config as Function)(
      {},
      { command: 'build', mode: 'production' }
    ) as {
      environments: {
        client: { build: { outDir: string } };
        ssr: {
          build: {
            outDir: string;
            ssr: boolean;
            rollupOptions: { input: string[] };
          };
        };
      };
    };
    expect(cfg.environments.client.build.outDir).toBe('dist/client');
    expect(cfg.environments.ssr.build.outDir).toBe('dist/server');
    expect(cfg.environments.ssr.build.ssr).toBe(true);
    expect(cfg.environments.ssr.build.rollupOptions.input).toEqual([
      ctx.entryWrapperId,
    ]);
  });

  it('builds the app via a builder.buildApp orchestrator', () => {
    const plugin = nodeBuildPlugin(ctx);
    const cfg = (plugin.config as Function)(
      {},
      { command: 'build', mode: 'production' }
    ) as { builder: { buildApp: unknown } };
    expect(typeof cfg.builder.buildApp).toBe('function');
  });
});

describe('nodeDevServerPlugin', () => {
  it('is a serve-only plugin with a configureServer hook', () => {
    const plugin = nodeDevServerPlugin({
      root: '/p',
      coreAppModuleId: '/p/a.tsx',
      entryWrapperId: '/p/b.tsx',
    });
    expect(plugin.name).toBe('hono-preact:node-dev-server');
    expect(plugin.apply).toBe('serve');
    expect(typeof plugin.configureServer).toBe('function');
  });
});
