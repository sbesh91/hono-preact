import { describe, it, expect } from 'vitest';
import type { Plugin } from 'vite';
import { routeServerAutodiscoveryPlugin } from '../route-server-autodiscovery.js';

type TransformFn = (
  code: string,
  id: string
) => { code: string; map: unknown } | undefined;

const ROUTES_ID = '/repo/src/routes.ts';

// Build the plugin with a fake existence probe over a fixed set of absolute
// server-module paths, so tests never touch the real filesystem.
function makePlugin(existing: string[] = []) {
  const set = new Set(existing);
  const plugin = routeServerAutodiscoveryPlugin({
    fileExists: (p) => set.has(p),
  }) as Plugin & { transform: TransformFn };
  return plugin;
}

function transform(plugin: Plugin & { transform: TransformFn }, code: string) {
  return plugin.transform.call({} as never, code, ROUTES_ID);
}

describe('routeServerAutodiscoveryPlugin', () => {
  it('injects a server thunk for a view whose .server sibling exists', () => {
    const plugin = makePlugin(['/repo/src/pages/login.server.ts']);
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login.js') },
    ]);`;
    const out = transform(plugin, code);
    expect(out?.code).toContain(
      `view: () => import('./pages/login.js'), server: () => import("./pages/login.server.js")`
    );
  });

  it('injects for a layout-anchored route (branch with colocated server)', () => {
    const plugin = makePlugin(['/repo/src/pages/projects.server.tsx']);
    const code = `export default defineRoutes([
      { path: 'projects', layout: () => import('./pages/projects.js'), children: [] },
    ]);`;
    const out = transform(plugin, code);
    expect(out?.code).toContain(
      `server: () => import("./pages/projects.server.js")`
    );
  });

  it('discovers routes nested inside children arrays', () => {
    const plugin = makePlugin(['/repo/src/pages/demo/task.server.ts']);
    const code = `export default defineRoutes([
      { path: 'demo', layout: () => import('./pages/demo/layout.js'), children: [
        { path: 'task', view: () => import('./pages/demo/task.js') },
      ] },
    ]);`;
    const out = transform(plugin, code);
    // The nested leaf gets a server thunk; the layout (no sibling on disk) does not.
    expect(out?.code).toContain(
      `import('./pages/demo/task.js'), server: () => import("./pages/demo/task.server.js")`
    );
    expect(out?.code).not.toContain('demo/layout.server');
  });

  it('does not inject when an explicit server field is already present', () => {
    const plugin = makePlugin(['/repo/src/pages/login.server.ts']);
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login.js'), server: () => import('./elsewhere.server.js') },
    ]);`;
    const out = transform(plugin, code);
    // No transform at all: the existing field wins.
    expect(out).toBeUndefined();
  });

  it('respects `server: false` as an explicit opt-out', () => {
    const plugin = makePlugin(['/repo/src/pages/login.server.ts']);
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login.js'), server: false },
    ]);`;
    // The `server` key is present (even though false), so discovery skips it.
    expect(transform(plugin, code)).toBeUndefined();
  });

  it('announces each discovered module once in dev (deduped across passes)', () => {
    const set = new Set(['/repo/src/pages/login.server.ts']);
    const logs: string[] = [];
    const plugin = routeServerAutodiscoveryPlugin({
      fileExists: (p) => set.has(p),
    }) as Plugin & {
      transform: TransformFn;
      configResolved: (c: {
        command: string;
        logger: { info(m: string): void };
      }) => void;
    };
    plugin.configResolved({
      command: 'serve',
      logger: { info: (m) => logs.push(m) },
    });
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login.js') },
    ]);`;
    // Two passes (client + SSR) should announce the route exactly once.
    plugin.transform.call({} as never, code, ROUTES_ID);
    plugin.transform.call({} as never, code, ROUTES_ID);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("route 'login'");
    expect(logs[0]).toContain('./pages/login.server.js');
  });

  it('does not inject when no sibling exists on disk', () => {
    const plugin = makePlugin([]); // nothing exists
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login.js') },
    ]);`;
    expect(transform(plugin, code)).toBeUndefined();
  });

  it('ignores a non-bare thunk (contentRoutes-style .then wrapper)', () => {
    const plugin = makePlugin(['/repo/src/pages/doc.server.ts']);
    const code = `export default defineRoutes([
      { path: 'doc', view: () => import('./pages/doc.js').then(wrap) },
    ]);`;
    // The value is not a bare import arrow, so it is not a discovery anchor.
    expect(transform(plugin, code)).toBeUndefined();
  });

  it('ignores object literals without a path key', () => {
    const plugin = makePlugin(['/repo/src/pages/login.server.ts']);
    const code = `const opts = { view: () => import('./pages/login.js') };`;
    expect(transform(plugin, code)).toBeUndefined();
  });

  it('probes tsx and jsx siblings, not just ts', () => {
    const plugin = makePlugin(['/repo/src/pages/board.server.jsx']);
    const code = `export default defineRoutes([
      { path: 'board', view: () => import('./pages/board.js') },
    ]);`;
    const out = transform(plugin, code);
    expect(out?.code).toContain(
      `server: () => import("./pages/board.server.js")`
    );
  });

  it('skips .server.* modules entirely', () => {
    const plugin = makePlugin(['/repo/src/pages/login.server.ts']);
    const code = `export const serverLoaders = { view: () => import('./x.js') };`;
    const out = plugin.transform.call(
      {} as never,
      code,
      '/repo/src/pages/login.server.ts'
    );
    expect(out).toBeUndefined();
  });

  it('skips files with no dynamic import (cheap pre-filter)', () => {
    const plugin = makePlugin(['/repo/src/pages/login.server.ts']);
    const code = `export const view = 1; export const layout = 2;`;
    expect(transform(plugin, code)).toBeUndefined();
  });
});
