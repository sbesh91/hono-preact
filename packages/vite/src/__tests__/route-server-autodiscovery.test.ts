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

  it('injects a resolvable .server.js when the view uses a non-.js extension differing from the sibling', () => {
    // View imported as `.tsx`; sibling on disk is `.server.ts`. The injected
    // specifier must be the resolvable `.server.js`, NOT `.server.tsx` copied
    // from the view extension (Vite cannot resolve a nonexistent `.server.tsx`).
    const plugin = makePlugin(['/repo/src/pages/login.server.ts']);
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login.tsx') },
    ]);`;
    const out = transform(plugin, code);
    expect(out?.code).toContain(
      `server: () => import("./pages/login.server.js")`
    );
    expect(out?.code).not.toContain('login.server.tsx');
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

  it('injects the literal .server.jsx for a .jsx sibling (Vite cannot remap .js -> .jsx)', () => {
    const plugin = makePlugin(['/repo/src/pages/board.server.jsx']);
    const code = `export default defineRoutes([
      { path: 'board', view: () => import('./pages/board.js') },
    ]);`;
    const out = transform(plugin, code);
    // A `.jsx` sibling keeps its literal extension: `.server.js` resolves only to
    // `.js`/`.ts`/`.tsx`, never `.jsx`, so the discovered `.jsx` must be emitted.
    expect(out?.code).toContain(
      `server: () => import("./pages/board.server.jsx")`
    );
  });

  it('injects a resolvable .server.jsx for a .jsx view beside a .jsx sibling', () => {
    // Regression guard: a `.jsx` view whose sibling is `.server.jsx` must not
    // collapse to an unresolvable `.server.js` (Vite maps `.js` only to
    // `.js`/`.ts`/`.tsx`).
    const plugin = makePlugin(['/repo/src/pages/board.server.jsx']);
    const code = `export default defineRoutes([
      { path: 'board', view: () => import('./pages/board.jsx') },
    ]);`;
    const out = transform(plugin, code);
    expect(out?.code).toContain(
      `server: () => import("./pages/board.server.jsx")`
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

  it('warns once when an extensionless view import has a colocated server sibling', () => {
    // `import('./pages/login')` has no extension to splice `.server` into, so
    // discovery declines. But a `login.server.ts` sibling exists, so the author
    // almost certainly expected it wired. `this.warn` names the real cause and
    // (unlike the build-only orphan scan) reaches `vite dev` too.
    const plugin = makePlugin(['/repo/src/pages/login.server.ts']);
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login') },
    ]);`;
    const warnings: string[] = [];
    const ctx = { warn: (m: string) => warnings.push(m) } as never;
    // Two passes (client + SSR) must warn exactly once (deduped).
    const a = plugin.transform.call(ctx, code, ROUTES_ID);
    const b = plugin.transform.call(ctx, code, ROUTES_ID);
    // Discovery still declines: there is no extension to splice `.server` into.
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('./pages/login');
    expect(warnings[0]).toContain('no file extension');
    expect(warnings[0]).toContain('login.server.ts');
  });

  it('stays silent for an extensionless view import with no server sibling', () => {
    // An ordinary extensionless view (no colocated server module) is a legitimate
    // route; it must not be nagged.
    const plugin = makePlugin([]); // nothing on disk
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login') },
    ]);`;
    const warnings: string[] = [];
    const out = plugin.transform.call(
      { warn: (m: string) => warnings.push(m) } as never,
      code,
      ROUTES_ID
    );
    expect(out).toBeUndefined();
    expect(warnings).toHaveLength(0);
  });

  it('warns per distinct extensionless view (dedup is keyed per sibling, not global)', () => {
    // Two different extensionless views, each with its own server sibling, must
    // each warn: the dedup is keyed per resolved sibling base, not a single
    // global "warned once" flag.
    const plugin = makePlugin([
      '/repo/src/pages/login.server.ts',
      '/repo/src/pages/signup.server.ts',
    ]);
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login') },
      { path: 'signup', view: () => import('./pages/signup') },
    ]);`;
    const warnings: string[] = [];
    plugin.transform.call(
      { warn: (m: string) => warnings.push(m) } as never,
      code,
      ROUTES_ID
    );
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.includes('login.server.ts'))).toBe(true);
    expect(warnings.some((w) => w.includes('signup.server.ts'))).toBe(true);
  });
});

// Orphan check: buildEnd warns about a *.server.* file no route imports.
type BuildEndFn = () => void;
function makeOrphanPlugin(serverModules: string[], command = 'build') {
  const plugin = routeServerAutodiscoveryPlugin({
    listServerModules: () => serverModules,
  }) as Plugin & {
    configResolved: (c: {
      command: string;
      root: string;
      logger: { info(m: string): void };
    }) => void;
    buildEnd: BuildEndFn;
  };
  plugin.configResolved({ command, root: '/repo', logger: { info() {} } });
  return plugin;
}

function runBuildEnd(
  plugin: Plugin & { buildEnd: BuildEndFn },
  ctx: {
    envName?: string;
    graph: string[];
  }
) {
  const warnings: string[] = [];
  plugin.buildEnd.call({
    environment: ctx.envName ? { name: ctx.envName } : undefined,
    getModuleIds: () => ctx.graph,
    warn: (m: string) => warnings.push(m),
  } as never);
  return warnings;
}

describe('routeServerAutodiscoveryPlugin orphan check', () => {
  it('warns about a server file that no module in the graph imports', () => {
    const plugin = makeOrphanPlugin([
      '/repo/src/pages/login.server.ts',
      '/repo/src/pages/orphan.server.ts',
    ]);
    const warnings = runBuildEnd(plugin, {
      envName: 'ssr',
      graph: ['/repo/src/pages/login.server.ts', '/repo/src/routes.ts'],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('src/pages/orphan.server.ts');
    expect(warnings[0]).toContain('no route imports it');
  });

  it('does not warn when every server file is in the graph (query-suffix tolerant)', () => {
    const plugin = makeOrphanPlugin(['/repo/src/pages/login.server.ts']);
    const warnings = runBuildEnd(plugin, {
      envName: 'ssr',
      graph: ['/repo/src/pages/login.server.ts?v=1'],
    });
    expect(warnings).toHaveLength(0);
  });

  it('skips the client build (server imports are stubbed there)', () => {
    const plugin = makeOrphanPlugin(['/repo/src/pages/orphan.server.ts']);
    const warnings = runBuildEnd(plugin, { envName: 'client', graph: [] });
    expect(warnings).toHaveLength(0);
  });

  it('skips dev (the module graph is lazy during serve)', () => {
    const plugin = makeOrphanPlugin(
      ['/repo/src/pages/orphan.server.ts'],
      'serve'
    );
    const warnings = runBuildEnd(plugin, { envName: 'ssr', graph: [] });
    expect(warnings).toHaveLength(0);
  });

  it('does not double-warn: an extensionless-declined sibling is skipped by the orphan scan', () => {
    // The transform already warned (more actionably) that this sibling can't be
    // auto-discovered because its view import lacks an extension; the generic
    // orphan warn for the same file would be redundant, so buildEnd skips it.
    const existing = '/repo/src/pages/login.server.ts';
    const set = new Set([existing]);
    const plugin = routeServerAutodiscoveryPlugin({
      fileExists: (p) => set.has(p),
      listServerModules: () => [existing],
    }) as Plugin & {
      transform: TransformFn;
      configResolved: (c: {
        command: string;
        root: string;
        logger: { info(m: string): void };
      }) => void;
      buildEnd: BuildEndFn;
    };
    plugin.configResolved({
      command: 'build',
      root: '/repo',
      logger: { info() {} },
    });

    // Transform declines the extensionless view and records the sibling base.
    const transformWarnings: string[] = [];
    plugin.transform.call(
      { warn: (m: string) => transformWarnings.push(m) } as never,
      `export default defineRoutes([
        { path: 'login', view: () => import('./pages/login') },
      ]);`,
      ROUTES_ID
    );
    expect(transformWarnings).toHaveLength(1);

    // The orphan scan must NOT warn again about the same (now-declined) file,
    // even though it is absent from the module graph.
    const orphanWarnings = runBuildEnd(plugin, {
      envName: 'ssr',
      graph: ['/repo/src/routes.ts'],
    });
    expect(orphanWarnings).toHaveLength(0);
  });

  // Under Vite 8, `this.addWatchFile(id)` also registers `id` as a module
  // import (fed to import-analysis). Watching a *non-existent* server sibling
  // therefore makes the route table fail to resolve it and 500s the dev server.
  // Discovery must never hand a path to `addWatchFile`; re-triggering when a
  // server file is created is done by the dev-server watcher instead (below).
  it('never calls addWatchFile for an absent server sibling', () => {
    const plugin = makePlugin([]); // nothing on disk
    const watched: string[] = [];
    const ctx = {
      addWatchFile: (p: string) => watched.push(p),
      warn: () => {},
    } as never;
    const code = `export default defineRoutes([
      { path: '/', view: () => import('./pages/home.js') },
    ]);`;
    const out = plugin.transform.call(ctx, code, ROUTES_ID);
    // No server thunk (no sibling), and crucially no watched (imported) path.
    expect(out).toBeUndefined();
    expect(watched).toHaveLength(0);
  });

  it('does not call addWatchFile even when the sibling exists (watch is via the dev-server watcher, not the import graph)', () => {
    const plugin = makePlugin(['/repo/src/pages/login.server.ts']);
    const watched: string[] = [];
    const ctx = {
      addWatchFile: (p: string) => watched.push(p),
      warn: () => {},
    } as never;
    const code = `export default defineRoutes([
      { path: 'login', view: () => import('./pages/login.js') },
    ]);`;
    const out = plugin.transform.call(ctx, code, ROUTES_ID);
    expect(out?.code).toContain(
      `server: () => import("./pages/login.server.js")`
    );
    expect(watched).toHaveLength(0);
  });

  it('re-triggers discovery on known route tables when a .server file is created mid dev-session', () => {
    const plugin = makePlugin([]) as Plugin & {
      transform: TransformFn;
      configureServer: (server: never) => void;
    };
    // A route table with a serverless route is recorded when first transformed.
    plugin.transform.call(
      {} as never,
      `export default defineRoutes([
        { path: '/', view: () => import('./pages/home.js') },
      ]);`,
      ROUTES_ID
    );

    // Minimal chokidar-like watcher: records emits and dispatches to handlers.
    const handlers: Record<string, ((f: string) => void)[]> = {};
    const emitted: Array<[string, string]> = [];
    const watcher = {
      on(event: string, cb: (f: string) => void) {
        (handlers[event] ??= []).push(cb);
      },
      emit(event: string, file: string) {
        emitted.push([event, file]);
        for (const h of handlers[event] ?? []) h(file);
      },
    };
    plugin.configureServer({ watcher } as never);

    // A non-server file being added must not re-trigger anything.
    watcher.emit('add', '/repo/src/pages/about.tsx');
    expect(emitted.filter(([e]) => e === 'change')).toHaveLength(0);

    // Creating the colocated server module replays a change to the route table,
    // so Vite invalidates + reloads and discovery re-runs (now finding it).
    watcher.emit('add', '/repo/src/pages/home.server.ts');
    expect(emitted).toContainEqual(['change', ROUTES_ID]);
  });
});
