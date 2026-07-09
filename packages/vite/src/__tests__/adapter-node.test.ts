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

  it('wrapEntry installs a preload-closure reader that fs-reads the build artifact', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    expect(tail).toContain('installPreloadModules');
    expect(tail).toContain('__hp-preload.json');
    expect(tail).toContain("from 'hono-preact/server/internal/runtime'");
  });

  it('wrapEntry warns on a failed manifest read, guarded so it is silent on a dev module-runner load', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    // The generated reader's catch: a real prod read failure must be
    // observable (the manifest now carries render-critical CSS), but `vite
    // dev` loads this wrapper through the SSR module runner where
    // dist/client never exists, so the warn is gated on PROD like the
    // serve() boot is, not unconditional.
    const catchBlock = tail.slice(
      tail.indexOf('installPreloadModules'),
      tail.indexOf('const app = new Hono()')
    );
    expect(catchBlock).toContain('catch (err)');
    expect(catchBlock).toContain('if (import.meta.env.PROD)');
    expect(catchBlock).toContain('console.warn(');
    expect(catchBlock).toContain('preload manifest read failed');
    expect(catchBlock).toContain('err');
  });

  it('wrapEntry uses createNodeWebSocket and installWebSocketUpgrader', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    expect(tail).toContain("from '@hono/node-ws'");
    expect(tail).toContain('createNodeWebSocket');
    expect(tail).toContain('installWebSocketUpgrader');
    expect(tail).toContain("from 'hono-preact/internal/runtime'");
  });

  it('wrapEntry always exports app and injectWebSocket from the framework', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    expect(tail).toContain('export { app, injectWebSocket }');
    expect(tail).toContain('injectWebSocket(server)');
  });

  it('wrapEntry is api-agnostic: does not import api module', () => {
    const tail = nodeAdapter().wrapEntry({
      ...ctx,
      apiModuleId: '/p/src/api.ts',
    });
    // api module is mounted inside createServerEntry, not in the wrapper
    expect(tail).not.toContain('/p/src/api.ts');
    expect(tail).not.toContain('__api');
  });

  it('wrapEntry omits the api import when there is no api module', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    expect(tail).not.toContain('__api');
  });

  it('guards serve() so dev module-runner loads do not start a server', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    expect(tail).toContain('import.meta.env.PROD');
  });
});
