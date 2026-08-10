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

  it('wrapEntry gates the manifest read on PROD, so a dev module-runner load never touches disk', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    // A stale dist/client left over from a previous build would otherwise
    // read successfully under `vite dev` and serve hashed stylesheet URLs
    // that 404 render-blockingly (see render.tsx's dev seam); gating the
    // read itself on PROD, not just the warn, is what prevents that read
    // from ever happening in dev.
    const block = tail.slice(
      tail.indexOf('installPreloadModules'),
      tail.indexOf('const app = new Hono()')
    );
    expect(block).toContain('if (!import.meta.env.PROD) return {};');
    expect(block).toContain('readFileSync');
  });

  it('wrapEntry rethrows a failed manifest read instead of degrading to {} locally', () => {
    const tail = nodeAdapter().wrapEntry(ctx);
    // resolvePreloadManifest's own catch must own the warn and the
    // non-memoized retry (so a transient prod failure recovers on the next
    // request); the generated reader rethrows rather than swallowing the
    // failure into `{}` itself.
    const block = tail.slice(
      tail.indexOf('installPreloadModules'),
      tail.indexOf('const app = new Hono()')
    );
    expect(block).toContain('catch (err)');
    expect(block).toContain('throw new Error(');
    expect(block).toContain('preload manifest read failed');
    expect(block).toContain('__hp-preload.json');
    expect(block).not.toContain('console.warn(');
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

describe('nodeAdapter wrapEntry client-dir resolution', () => {
  const src = nodeAdapter().wrapEntry(ctx);

  it('resolves the client build directory from import.meta.dirname', () => {
    expect(src).toContain(
      "const __hpClientDir = join(import.meta.dirname, '../client')"
    );
    expect(src).toContain("import { join } from 'node:path'");
  });

  // The cwd-relative spellings are the defect. If either reappears, the built
  // server only works when started from the project root.
  it('emits no cwd-relative dist/client path', () => {
    expect(src).not.toContain("'./dist/client'");
    expect(src).not.toContain('./dist/client/');
  });

  it('serves static assets and reads the manifest from that directory', () => {
    expect(src).toContain('serveStatic({ root: __hpClientDir })');
    expect(src).toContain('join(__hpClientDir,');
  });

  // serveStatic's setup does an existsSync on `root` and console.errors when it
  // is missing. In dev the wrapper is loaded through the SSR module runner from
  // node_modules/.vite/hono-preact/, where ../client never exists, so mounting
  // it unconditionally would print a spurious error on every dev boot. Dev also
  // has no business serving a build directory at all: Vite serves those assets.
  it('mounts the static middleware only in production', () => {
    expect(src).toContain('if (import.meta.env.PROD) {');
    const mountIdx = src.indexOf('serveStatic({ root: __hpClientDir })');
    const guardIdx = src.indexOf('if (import.meta.env.PROD) {');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(mountIdx).toBeGreaterThan(guardIdx);
  });
});
