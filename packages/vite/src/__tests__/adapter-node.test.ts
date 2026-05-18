import { describe, it, expect } from 'vitest';
import { nodeAdapter } from '../adapter-node.js';

const ctx = {
  root: '/p',
  coreAppModuleId: '/p/node_modules/.vite/hono-preact/core-app.tsx',
  entryWrapperId: '/p/node_modules/.vite/hono-preact/server-entry.tsx',
};

describe('nodeAdapter', () => {
  it('is named "node"', () => {
    expect(nodeAdapter().name).toBe('node');
  });

  it('wrapEntry composes an outer app: static assets, core app, serve()', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    expect(tail).toContain("from '@hono/node-server'");
    expect(tail).toContain('serveStatic');
    expect(tail).toContain(ctx.coreAppModuleId);
    expect(tail).toContain('serve(');
  });

  it('exposes a vitePlugins function', () => {
    expect(typeof nodeAdapter().vitePlugins).toBe('function');
  });

  it('wrapEntry re-exports injectWebSocket when an api module is present', () => {
    const tail = nodeAdapter().wrapEntry({
      ...ctx,
      apiModuleId: '/p/src/api.ts',
    });
    expect(tail).toContain('/p/src/api.ts');
    expect(tail).toContain('injectWebSocket');
  });

  it('wrapEntry omits the api import when there is no api module', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    expect(tail).not.toContain('injectWebSocket');
  });

  it('guards serve() so dev module-runner loads do not start a server', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    expect(tail).toContain('import.meta.env.PROD');
  });
});
