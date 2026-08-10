# v0.14 Track A batch 2 (vite / adapters) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Vite plugin's generated paths honour a custom Vite `root`, make the Node adapter's built output run from any cwd, and give the Node dev server an escape hatch for app routes that collide with Vite's internal prefixes.

**Architecture:** One shared lazily-resolved root holder replaces three independent `process.cwd()` reads in the Vite package, and `serverEntryPlugin` (which Vite runs first, being `enforce: 'pre'`) becomes the sole owner of the two generated-file paths. The Node adapter's emitted entry wrapper resolves the client build directory from `import.meta.dirname` instead of the process cwd. The Node dev server gains an opt-in `devSsrInclude` pattern list, matched ahead of its built-in Vite-internal pass-through.

**Tech Stack:** TypeScript, Vite 8 plugin API, Vitest, `@hono/node-server`.

Spec: `docs/superpowers/specs/2026-08-09-v014-track-a-vite-adapters-design.md`
Issue: #319. Promoted out and NOT in scope: #375 (CF realtime DO gating), #376 (`emitClientAsset`).

## Global Constraints

- No em-dashes in prose, comments, or commit messages. Use a comma, semicolon, colon, parentheses, or two sentences.
- Node engine floor is `^22.18.0 || >=24.11.0`. `import.meta.dirname` is available; do not add a `fileURLToPath(import.meta.url)` shim for it.
- Avoid type casts. If a cast seems needed, reshape the type instead. Existing tests in this package use `(plugin.config as Function)(...)`; do not copy that into new code, use the `callConfig` helper pattern already in `packages/vite/src/__tests__/hono-preact.test.ts`.
- `serverEntryPlugin` writes the generated files in its `config` hook deliberately, so the entry wrapper exists before `@cloudflare/vite-plugin`'s `config` hook runs `fs.existsSync` on the wrangler `main` path. Do not move that write to `configResolved` or any later hook.
- Vite runs `enforce: 'pre'` plugins' `config` hooks BEFORE unenforced ones. Verified empirically: the order is `hono-preact:server-entry`, then `hono-preact:config`. Any design that requires `hono-preact:config` to run first is wrong.
- Framework packages exclude `src/**/__tests__/**` from their build `tsconfig`, so `pnpm typecheck` never typechecks test files. Run `pnpm typecheck:tests` as well.
- `pnpm --filter <pkg> test` is a silent no-op in this repo. Run tests as `pnpm exec vitest run <pattern>` from the repo root.
- The framework `dist/` must be current before `pnpm typecheck` or any `apps/site` work: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`.

---

### Task 1: Single lazily-resolved Vite root

**Files:**

- Create: `packages/vite/src/root.ts`
- Create: `packages/vite/src/__tests__/root.test.ts`
- Modify: `packages/vite/src/hono-preact.ts` (the `ctx` literal at ~`:111-115`, `resolvedRoot` at `:123`, `configPlugin.config` at `:134-135`, `configEnvironment` at `:204-212`, the `generatedCoreAppAbsPath()` / `generatedEntryWrapperAbsPath()` calls at `:109-110`, and the `serverEntryPlugin({...})` call at `:227-237`)
- Modify: `packages/vite/src/server-entry.ts` (`ServerEntryPluginOptions`, and the `config` hook's root computation and file writes)
- Test: `packages/vite/src/__tests__/root.test.ts`, `packages/vite/src/__tests__/server-entry.test.ts`

**Interfaces:**

- Produces: `createRootRef(): RootRef` from `packages/vite/src/root.ts`, where `RootRef` is `{ set(userConfig: Pick<UserConfig, 'root'>): string; get(): string }`. `set` resolves and memoizes on first call and returns the resolved root; later calls return the memoized value and ignore their argument. `get` returns the memoized root, or `process.cwd()` if `set` has not run.
- Produces: `ServerEntryPluginOptions` loses `coreAppPath` and `entryWrapperPath` and gains `rootRef: RootRef`.
- Consumes: `generatedCoreAppAbsPath(cwd?)` and `generatedEntryWrapperAbsPath(cwd?)` already exist in `server-entry.ts` and already accept a root argument. Do not change their signatures.

- [ ] **Step 1: Write the failing test for the root holder**

Create `packages/vite/src/__tests__/root.test.ts`:

```ts
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createRootRef } from '../root.js';

describe('createRootRef', () => {
  it('falls back to process.cwd() before set() runs', () => {
    expect(createRootRef().get()).toBe(process.cwd());
  });

  it('resolves a relative userConfig.root to an absolute path', () => {
    const ref = createRootRef();
    expect(ref.set({ root: 'sub/app' })).toBe(
      path.resolve(process.cwd(), 'sub/app')
    );
    expect(ref.get()).toBe(path.resolve(process.cwd(), 'sub/app'));
  });

  it('keeps an absolute userConfig.root as-is', () => {
    const ref = createRootRef();
    const abs = path.resolve('/tmp/some-app');
    expect(ref.set({ root: abs })).toBe(abs);
  });

  it('uses process.cwd() when userConfig has no root', () => {
    const ref = createRootRef();
    expect(ref.set({})).toBe(process.cwd());
  });

  // First writer wins: `hono-preact:server-entry` (enforce: 'pre') and
  // `hono-preact:config` both call set() with the same userConfig, and a Vite
  // restart constructs a fresh ref. A second call must not be able to move the
  // root out from under a path already handed to an adapter.
  it('memoizes: a later set() cannot change the resolved root', () => {
    const ref = createRootRef();
    const first = ref.set({ root: '/tmp/first' });
    expect(ref.set({ root: '/tmp/second' })).toBe(first);
    expect(ref.get()).toBe(first);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/root.test.ts`
Expected: FAIL, cannot resolve `../root.js`.

- [ ] **Step 3: Implement the root holder**

Create `packages/vite/src/root.ts`:

```ts
import path from 'node:path';
import type { UserConfig } from 'vite';

/**
 * The single resolved Vite project root for one `honoPreact()` call.
 *
 * The root is not knowable when `honoPreact()` runs: `userConfig.root` first
 * appears in a `config` hook. Every path decision that used to read
 * `process.cwd()` at plugin-construction time silently pointed at the wrong
 * tree under a custom `root`. This holder defers that read.
 *
 * `set` is first-writer-wins because two plugins call it with the same
 * `userConfig` and Vite's hook order between them is not ours to depend on:
 * `enforce: 'pre'` plugins run first, so `hono-preact:server-entry` wins over
 * `hono-preact:config`. Memoizing means the value an adapter already captured
 * can never be moved underneath it.
 */
export interface RootRef {
  /** Resolve and memoize the root from a `config` hook's userConfig. */
  set(userConfig: Pick<UserConfig, 'root'>): string;
  /** The resolved root, or `process.cwd()` before any `config` hook ran. */
  get(): string;
}

export function createRootRef(): RootRef {
  let root: string | undefined;
  return {
    set(userConfig) {
      root ??= userConfig.root ? path.resolve(userConfig.root) : process.cwd();
      return root;
    },
    get() {
      return root ?? process.cwd();
    },
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm exec vitest run packages/vite/src/__tests__/root.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/root.ts packages/vite/src/__tests__/root.test.ts
git commit -m "feat(vite): add a lazily-resolved project-root holder"
```

- [ ] **Step 6: Write the failing test for custom-root path generation**

Append to `packages/vite/src/__tests__/server-entry.test.ts`. Read the top of that file first and reuse its existing imports and helpers rather than duplicating them; the snippet below assumes `serverEntryPlugin`, `node:fs`, `node:os`, and `node:path` are imported.

```ts
describe('serverEntryPlugin generated paths under a custom Vite root', () => {
  it('writes the core app and entry wrapper under userConfig.root, not cwd', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-root-'));
    const rootRef = createRootRef();
    const seen: string[] = [];

    const plugin = serverEntryPlugin({
      layout: 'src/Layout.tsx',
      routes: 'src/routes.ts',
      api: 'src/api.ts',
      appConfig: 'src/app-config.ts',
      serverDir: 'src/server',
      rootRef,
      adapter: {
        name: 'fake',
        vitePlugins: () => [],
        // Record what the adapter is handed, since that is the value a real
        // adapter bakes into its emitted entry.
        wrapEntry: (c) => {
          seen.push(c.coreAppModuleId, c.entryWrapperId);
          return 'export default {};\n';
        },
      },
    });

    await callConfig(plugin, { root: tmpRoot }, { command: 'build', mode: 'production' });

    const coreApp = path.join(tmpRoot, 'node_modules/.vite/hono-preact/core-app.tsx');
    const wrapper = path.join(tmpRoot, 'node_modules/.vite/hono-preact/server-entry.tsx');
    expect(fs.existsSync(coreApp)).toBe(true);
    expect(fs.existsSync(wrapper)).toBe(true);
    expect(seen).toEqual([coreApp, wrapper]);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});
```

If `server-entry.test.ts` has no `callConfig` helper, copy the one in `packages/vite/src/__tests__/hono-preact.test.ts` (it builds a real `ConfigPluginContext`, which these hooks need as `this`).

- [ ] **Step 7: Run it and verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts`
Expected: FAIL. `rootRef` is not a valid option, and `coreAppPath` / `entryWrapperPath` are still required.

- [ ] **Step 8: Make `serverEntryPlugin` own the generated paths**

In `packages/vite/src/server-entry.ts`:

1. Import the holder: `import type { RootRef } from './root.js';`
2. In `ServerEntryPluginOptions`, delete the `coreAppPath` and `entryWrapperPath` fields and add:

```ts
  /**
   * The shared root holder. This plugin is `enforce: 'pre'`, so its `config`
   * hook is the first to see `userConfig`; it resolves the root here and every
   * other consumer (the umbrella plugin's optimizer seed, the adapter context)
   * reads the same value back.
   */
  rootRef: RootRef;
```

3. In the `config(userConfig, env)` hook, replace

```ts
      const root = userConfig.root
        ? path.resolve(userConfig.root)
        : process.cwd();
```

with

```ts
      const root = opts.rootRef.set(userConfig);
      const coreAppPath = generatedCoreAppAbsPath(root);
      const entryWrapperPath = generatedEntryWrapperAbsPath(root);
```

4. Replace the three `opts.coreAppPath` / `opts.entryWrapperPath` reads in the write block with the new locals:

```ts
      fs.mkdirSync(path.dirname(coreAppPath), { recursive: true });
      fs.writeFileSync(coreAppPath, source, 'utf8');

      const wrapper = opts.adapter.wrapEntry({
        root,
        coreAppModuleId: coreAppPath,
        entryWrapperId: entryWrapperPath,
        apiModuleId: apiAbsPath,
      });
      fs.writeFileSync(entryWrapperPath, wrapper, 'utf8');
```

- [ ] **Step 9: Rewire `honoPreact()` onto the holder**

In `packages/vite/src/hono-preact.ts`:

1. Add `import { createRootRef } from './root.js';` and drop the now-unused `generatedCoreAppAbsPath` / `generatedEntryWrapperAbsPath` imports if nothing else in the file uses them.
2. Replace the `coreAppPath` / `entryWrapperPath` consts and the `ctx` literal (`:109-115`) with:

```ts
  const rootRef = createRootRef();

  // Getters, not values: `honoPreact()` runs before any Vite hook, so the root
  // is not yet knowable. Adapters read these fields from their own plugin
  // hooks, by which time `hono-preact:server-entry`'s `config` has resolved it.
  const ctx: HonoPreactAdapterContext = {
    get root() {
      return rootRef.get();
    },
    get coreAppModuleId() {
      return generatedCoreAppAbsPath(rootRef.get());
    },
    get entryWrapperId() {
      return generatedEntryWrapperAbsPath(rootRef.get());
    },
  };
```

(Keep the two `generated*AbsPath` imports; the getters use them.)

3. Delete the `let resolvedRoot = ctx.root;` declaration and its comment block (`:117-123`).
4. In `configPlugin.config`, replace `resolvedRoot = userConfig.root ? resolve(userConfig.root) : process.cwd();` with `rootRef.set(userConfig);`.
5. In `configEnvironment`, replace `entries: [resolve(resolvedRoot, routes)]` with `entries: [resolve(rootRef.get(), routes)]`.
6. In the `serverEntryPlugin({...})` call, delete the `coreAppPath` and `entryWrapperPath` properties and add `rootRef,`.
7. Drop the `resolve` import from `node:path` only if nothing else in the file uses it (`configEnvironment` still does, so it stays).

- [ ] **Step 10: Run the tests and verify they pass**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-entry.test.ts packages/vite/src/__tests__/hono-preact.test.ts packages/vite/src/__tests__/root.test.ts`
Expected: PASS. If `hono-preact.test.ts` asserted on the old `coreAppPath` option, update those assertions to read `ctx` off the fake adapter instead of the option.

- [ ] **Step 11: Run the full vite package suite**

Run: `pnpm exec vitest run packages/vite`
Expected: PASS. The Cloudflare adapter tests exercise `wrapEntry` with a `ctx`; a failure here means a getter is being read before any `config` hook ran, which is the pre-hook window the `process.cwd()` fallback covers. Do not "fix" that by removing the fallback.

- [ ] **Step 12: Commit**

```bash
git add packages/vite/src/hono-preact.ts packages/vite/src/server-entry.ts packages/vite/src/__tests__/server-entry.test.ts packages/vite/src/__tests__/hono-preact.test.ts
git commit -m "fix(vite): resolve generated entry paths against the Vite root, not cwd"
```

---

### Task 2: `@default` JSDoc on `HonoPreactCssOptions`

**Files:**

- Modify: `packages/vite/src/hono-preact.ts:22-34`

**Interfaces:**

- Consumes: nothing. Produces: nothing. Comment-only.

- [ ] **Step 1: Convert the two prose defaults to `@default` tags**

Replace the `autoSplit` and `minSize` members of `HonoPreactCssOptions` with:

```ts
  /**
   * Split the global stylesheet per route chunk at build time.
   * Only meaningful when `global` is set.
   * @default true
   */
  autoSplit?: boolean;

  /**
   * Minimum per-chunk scoped sheet size in bytes; anything smaller stays in
   * the global sheet.
   * @default 1024
   */
  minSize?: number;
```

Leave `global` as it is: it has no default, and its comment carries a real
constraint (the app must not also link the sheet manually).

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @hono-preact/vite exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/hono-preact.ts
git commit -m "docs(vite): surface HonoPreactCssOptions defaults via @default JSDoc"
```

---

### Task 3: Node adapter resolves the client build from `import.meta.dirname`

**Files:**

- Modify: `packages/vite/src/adapter-node.ts` (the `wrapEntry` template)
- Test: `packages/vite/src/__tests__/adapter-node.test.ts`, `smoke/built-output.smoke.test.ts`

**Interfaces:**

- Consumes: `PRELOAD_MANIFEST_FILE` from `@hono-preact/iso/internal/contract`, already imported in this file.
- Produces: the emitted wrapper declares `const __hpClientDir`. Nothing else reads it; it is internal to the generated module.

- [ ] **Step 1: Write the failing unit test on the emitted source**

Append to `packages/vite/src/__tests__/adapter-node.test.ts` (reuse the file's existing `ctx` fixture and `nodeAdapter` import):

```ts
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
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/adapter-node.test.ts`
Expected: FAIL on the `__hpClientDir` assertions.

- [ ] **Step 3: Update the emitted wrapper**

In `packages/vite/src/adapter-node.ts`'s `wrapEntry`:

1. Add to the import block: `` `import { join } from 'node:path';\n` + ``
2. After the `import coreApp ...` line, add:

```ts
        `\n` +
        // The built server entry lands at <root>/dist/server/, so the client
        // build is deterministically ../client from it. Resolving from
        // import.meta.dirname rather than the process cwd is what lets the
        // built server run from anywhere: a systemd unit with no
        // WorkingDirectory, a Docker image with a different WORKDIR, or a
        // monorepo script invoked from the repo root.
        `const __hpClientDir = join(import.meta.dirname, '../client');\n` +
```

3. Replace the manifest read line with:

```ts
        `    return JSON.parse(readFileSync(join(__hpClientDir, '${PRELOAD_MANIFEST_FILE}'), 'utf8'));\n` +
```

and the error message line with:

```ts
        `    throw new Error('[hono-preact] preload manifest read failed in ' + __hpClientDir + ': ' + (err instanceof Error ? err.message : String(err)));\n` +
```

4. Replace the app construction with a PROD-gated static mount:

```ts
        `const app = new Hono();\n` +
        `// Only in production: in dev this wrapper is loaded from\n` +
        `// node_modules/.vite/hono-preact/, where ../client does not exist, and\n` +
        `// Vite serves client assets itself. serveStatic existsSync-checks its\n` +
        `// root at setup and would console.error on every dev boot.\n` +
        `if (import.meta.env.PROD) {\n` +
        `  app.use('/static/*', serveStatic({ root: __hpClientDir }));\n` +
        `}\n` +
        `app.route('/', coreApp);\n` +
```

- [ ] **Step 4: Run the unit test and verify it passes**

Run: `pnpm exec vitest run packages/vite/src/__tests__/adapter-node.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the foreign-cwd smoke assertion**

In `smoke/built-output.smoke.test.ts`:

1. Add an optional field to `BuiltTarget`, documented:

```ts
  /**
   * When set, the built server is also started a second time from the repo
   * root instead of the app directory, and a real client asset is fetched
   * from it. This is the only way to catch a cwd-relative path baked into the
   * emitted entry: it is a property of the built module's runtime cwd, so no
   * unit test can reproduce it.
   */
  foreignCwdServe?: (port: number) => { cmd: string; args: string[] };
```

2. On the Node target only, add:

```ts
    foreignCwdServe: () => ({
      cmd: 'node',
      args: [resolve(repoRoot, 'apps/example-node/dist/server/server-entry.js')],
    }),
```

3. Inside the `describe.each` body, destructure `foreignCwdServe` and add:

```ts
    it.skipIf(!foreignCwdServe)(
      'serves client assets when started from a foreign cwd',
      async () => {
        // Discover a real asset URL from the rendered page rather than
        // hard-coding a hashed filename.
        const html = await (await fetch(`http://localhost:${port}/`)).text();
        const asset = /\/static\/[A-Za-z0-9._-]+\.js/.exec(html)?.[0];
        expect(asset, `no /static/*.js URL in the rendered page`).toBeTruthy();

        const foreignPort = await freePort();
        const { cmd, args } = foreignCwdServe!(foreignPort);
        const foreign = spawn(cmd, args, {
          cwd: repoRoot,
          stdio: 'pipe',
          shell: false,
          env: { ...PROD_ENV, PORT: String(foreignPort), CI: 'true' },
        });
        try {
          await waitForServer(foreignPort, 60_000);
          const res = await fetch(`http://localhost:${foreignPort}${asset}`);
          expect(res.status, `${asset} from a foreign cwd -> ${res.status}`).toBe(200);
        } finally {
          foreign.kill('SIGTERM');
        }
      },
      120_000
    );
```

- [ ] **Step 6: Verify the smoke test fails on the OLD code, then passes on the new**

This is the mutation check the repo's test-the-caller rule requires: a smoke test that passes against the defect is worthless.

```bash
git stash push packages/vite/src/adapter-node.ts
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm test:smoke
```

Expected: FAIL on "serves client assets when started from a foreign cwd" (404 from the foreign-cwd server). Then restore and re-verify:

```bash
git stash pop
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm test:smoke
```

Expected: PASS, all targets.

- [ ] **Step 7: Typecheck the smoke sources**

Run: `pnpm typecheck:smoke`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/vite/src/adapter-node.ts packages/vite/src/__tests__/adapter-node.test.ts smoke/built-output.smoke.test.ts
git commit -m "fix(node-adapter): resolve the client build from import.meta.dirname"
```

---

### Task 4: `nodeAdapter({ devSsrInclude })`

**Files:**

- Modify: `packages/vite/src/node-dev-server.ts` (add `shouldForceSsr` and the options plumbing; the middleware's prefix check at ~`:84`)
- Modify: `packages/vite/src/adapter-node.ts` (`nodeAdapter` signature)
- Test: `packages/vite/src/__tests__/node-dev-server.test.ts`

**Interfaces:**

- Produces: `export interface NodeAdapterOptions { devSsrInclude?: readonly (string | RegExp)[] }` from `packages/vite/src/adapter-node.ts`, re-exported by `packages/hono-preact/src/adapter-node.ts` via its existing `export *`.
- Produces: `export function shouldForceSsr(path: string, patterns: readonly (string | RegExp)[]): boolean` from `packages/vite/src/node-dev-server.ts`.
- Produces: `nodeDevServerPlugin(ctx: HonoPreactAdapterContext, options?: NodeDevServerOptions): Plugin`, where `NodeDevServerOptions` is `{ devSsrInclude?: readonly (string | RegExp)[] }`. The second parameter is optional, so the existing single-argument call sites and tests keep compiling.

- [ ] **Step 1: Write the failing matcher tests**

Append to `packages/vite/src/__tests__/node-dev-server.test.ts`:

```ts
describe('shouldForceSsr', () => {
  it('is false with no patterns', () => {
    expect(shouldForceSsr('/@alice', [])).toBe(false);
  });

  it('matches a string pattern by prefix', () => {
    expect(shouldForceSsr('/@alice', ['/@'])).toBe(true);
    expect(shouldForceSsr('/users', ['/@'])).toBe(false);
  });

  it('matches a RegExp pattern', () => {
    expect(shouldForceSsr('/@alice', [/^\/@[a-z]+$/])).toBe(true);
    expect(shouldForceSsr('/@fs/x', [/^\/@[a-z]+$/])).toBe(false);
  });

  // A /g RegExp is stateful under .test(): lastIndex advances, so the same
  // pattern would match on one request and miss on the next. The plugin
  // normalizes g and y off, so a user pattern cannot make routing flaky.
  it('is not made stateful by a global-flag RegExp', () => {
    const patterns = [/\/@[a-z]+/g];
    expect(shouldForceSsr('/@alice', patterns)).toBe(
      shouldForceSsr('/@alice', patterns)
    );
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/node-dev-server.test.ts`
Expected: FAIL, `shouldForceSsr` is not exported.

- [ ] **Step 3: Implement the matcher and normalization**

In `packages/vite/src/node-dev-server.ts`, above `nodeDevServerPlugin`:

```ts
export interface NodeDevServerOptions {
  /**
   * Paths that must reach SSR in dev even though they collide with the
   * built-in Vite-internal pass-through prefixes (`/@`, `/node_modules/`).
   * A string matches by prefix; a RegExp matches by `.test()`. Matched
   * against the query-stripped request path.
   *
   * This is additive only. The built-in prefixes stay in force for everything
   * else, so no app config can break HMR or module loading by getting the
   * Vite-internal list wrong.
   *
   * @example ['/@'] // an app with /@:username profile routes
   */
  devSsrInclude?: readonly (string | RegExp)[];
}

/** True when `path` matches any force-to-SSR pattern. */
export function shouldForceSsr(
  path: string,
  patterns: readonly (string | RegExp)[]
): boolean {
  return patterns.some((p) =>
    typeof p === 'string' ? path.startsWith(p) : p.test(path)
  );
}

/**
 * Strip the `g` and `y` flags: both make `.test()` stateful via `lastIndex`,
 * which would make a user's pattern match every other request.
 */
function normalizePatterns(
  patterns: readonly (string | RegExp)[]
): readonly (string | RegExp)[] {
  return patterns.map((p) =>
    typeof p === 'string' ? p : new RegExp(p.source, p.flags.replace(/[gy]/g, ''))
  );
}
```

- [ ] **Step 4: Run the matcher tests and verify they pass**

Run: `pnpm exec vitest run packages/vite/src/__tests__/node-dev-server.test.ts -t shouldForceSsr`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing caller test**

The matcher passing says nothing about the middleware passing it the right argument, which is exactly the wrong-argument class of bug this repo's testing rule targets. Append to the same test file:

```ts
/**
 * Drive the real middleware the plugin registers. `configureServer` is called
 * with a stub server whose `middlewares.use` captures the handler, and whose
 * `environments.ssr` is enough for createServerModuleRunner not to throw.
 */
async function captureSsrMiddleware(options?: NodeDevServerOptions) {
  let handler:
    | ((req: { url?: string }, res: unknown, next: () => void) => Promise<void>)
    | undefined;
  const plugin = nodeDevServerPlugin(ctx, options);
  await (
    plugin.configureServer as (server: unknown) => void | Promise<void>
  )({
    environments: { ssr: { hot: { on() {} }, topLevelConfig: {} } },
    httpServer: { on() {} },
    middlewares: {
      use(fn: typeof handler) {
        handler ??= fn;
      },
    },
  });
  if (!handler) throw new Error('no middleware registered');
  return handler;
}

describe('nodeDevServerPlugin dev pass-through', () => {
  it('passes Vite-internal paths through by default', async () => {
    const handler = await captureSsrMiddleware();
    let nexted = false;
    await handler({ url: '/@vite/client' }, {}, () => (nexted = true));
    expect(nexted).toBe(true);
  });

  it('forces a devSsrInclude path to SSR instead of passing it through', async () => {
    const handler = await captureSsrMiddleware({ devSsrInclude: ['/@alice'] });
    let nexted = false;
    // The SSR path will throw (no real module runner), which is fine: the
    // assertion is that it did NOT take the pass-through branch.
    await handler({ url: '/@alice?tab=posts' }, {}, () => (nexted = true)).catch(
      () => {}
    );
    expect(nexted).toBe(false);
  });
});
```

If `createServerModuleRunner` cannot be satisfied by a stub, `vi.mock('vite', ...)` it for this file, keeping the real `nodeDevServerPlugin` under test. Do not restructure the plugin to make it mockable.

Note the query string in the second case: it proves the caller strips `?tab=posts` before matching, which a matcher-only test cannot show.

- [ ] **Step 6: Run it and verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/node-dev-server.test.ts`
Expected: FAIL, `nodeDevServerPlugin` takes one argument and the include path is still passed through.

- [ ] **Step 7: Wire the option into the middleware**

In `packages/vite/src/node-dev-server.ts`, change the signature and the check:

```ts
export function nodeDevServerPlugin(
  ctx: HonoPreactAdapterContext,
  options: NodeDevServerOptions = {}
): Plugin {
  const forcePatterns = normalizePatterns(options.devSsrInclude ?? []);
```

and, in the middleware, replace the pass-through branch with:

```ts
          const path = (req.url ?? '').split('?')[0];
          // `devSsrInclude` is checked FIRST: an app route like /@:username
          // otherwise disappears into the Vite-internal pass-through below and
          // never reaches SSR in dev, while working fine in production.
          if (
            !shouldForceSsr(path, forcePatterns) &&
            (path.startsWith('/@') || path.startsWith('/node_modules/'))
          ) {
            return next();
          }
```

Keep the existing comment above the prefix check explaining why `/@` and `/node_modules/` pass through.

- [ ] **Step 8: Add the option to `nodeAdapter`**

In `packages/vite/src/adapter-node.ts`:

```ts
import {
  nodeBuildPlugin,
  nodeDevServerPlugin,
  type NodeDevServerOptions,
} from './node-dev-server.js';

export interface NodeAdapterOptions {
  /**
   * Paths that must reach SSR in dev even though they collide with the Vite
   * dev server's internal `/@` and `/node_modules/` prefixes. A string matches
   * by prefix, a RegExp by `.test()`. Additive: the built-in prefixes still
   * apply to everything else.
   *
   * @example nodeAdapter({ devSsrInclude: ['/@'] })
   */
  devSsrInclude?: NodeDevServerOptions['devSsrInclude'];
}

export function nodeAdapter(options: NodeAdapterOptions = {}): HonoPreactAdapter {
  return {
    name: 'node',
    vitePlugins(ctx: HonoPreactAdapterContext) {
      return [
        nodeBuildPlugin(ctx),
        nodeDevServerPlugin(ctx, { devSsrInclude: options.devSsrInclude }),
      ];
    },
```

Leave `wrapEntry` unchanged.

- [ ] **Step 9: Run the tests and verify they pass**

Run: `pnpm exec vitest run packages/vite`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/vite/src/node-dev-server.ts packages/vite/src/adapter-node.ts packages/vite/src/__tests__/node-dev-server.test.ts
git commit -m "feat(node-adapter): add devSsrInclude to force app routes to SSR in dev"
```

---

### Task 5: Docs sync and full pre-push verification

Docs sync is a `REVIEW.md` must-check, and `devSsrInclude` is a new public API, so shipping it undocumented would fail review.

**Files:**

- Modify: `apps/site/src/pages/docs/vite-config.mdx` (the adapter paragraph at `:19` and the options table at `:25`)

- [ ] **Step 1: Document `nodeAdapter({ devSsrInclude })`**

Read `apps/site/src/pages/docs/vite-config.mdx` first and match its existing table and prose conventions. Add, after the paragraph that introduces the two adapters, a short subsection:

````mdx
### `nodeAdapter(options?)`

| Option          | Type                      | Default | Description                                                                                  |
| --------------- | ------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `devSsrInclude` | `(string \| RegExp)[]`    | `[]`    | Paths that must reach SSR in dev despite matching Vite's internal `/@` or `/node_modules/` prefixes. |

The dev server hands `/@…` and `/node_modules/…` requests to Vite, which owns
its HMR client and module graph. An app route that starts the same way, such as
a `/@:username` profile page, would never reach SSR in dev even though it works
in production. List it to force SSR:

```ts
nodeAdapter({ devSsrInclude: ['/@'] });
```

A string matches by prefix and a RegExp by `test()`, both against the path with
any query string removed. The built-in prefixes still apply to everything else.
````

Per the repo's docs rule, describe what the option is, not that it is new or what it replaces.

- [ ] **Step 2: Run the full pre-push sequence**

These are the nine CI steps in CI's order. Run all of them; `format:check` is the one most often forgotten.

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm typecheck:tests
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

If `format:check` fails, run `pnpm format` and commit the result.

- [ ] **Step 3: Run the smoke suite**

Run: `pnpm test:smoke`
Expected: PASS. This gate is required before merge (see `REVIEW.md`), and the PR needs the `run-smoke` label for CI to run it.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs/vite-config.mdx
git commit -m "docs: document nodeAdapter devSsrInclude"
```

- [ ] **Step 5: Open the PR**

Push the branch and open a PR against `main` referencing #319. Note in the body that #375 and #376 were promoted out of the batch per the issue's own rule, and that the PR needs the `run-smoke` label. Then immediately run a deep PR review per `REVIEW.md`, which is the repo's standing first follow-up step after opening any PR.

---

## Self-Review

**Spec coverage:** Spec item 1 (root resolution) is Tasks 1. Item 2 (CssOptions JSDoc) is Task 2. Item 3 (Node adapter cwd) is Task 3. Item 4 (`devSsrInclude`) is Task 4. The spec's non-goals are respected: no CF adapter change, no `emitClientAsset`, no `exclude` option, no output-layout change. Docs sync is not in the spec but is a `REVIEW.md` must-check for a new public option, hence Task 5.

**Type consistency:** `RootRef` (`set`/`get`) is used identically in Tasks 1's holder, `ServerEntryPluginOptions.rootRef`, and `honoPreact()`. `shouldForceSsr(path, patterns)` has the same two-parameter shape in its definition, its tests, and the middleware. `NodeDevServerOptions['devSsrInclude']` is the single source for the option's type, referenced by `NodeAdapterOptions` rather than re-spelled. `__hpClientDir` is spelled identically in the emitted template and every assertion.

**Known deviation from the spec, deliberate:** the spec described the Node fix as touching only the two read sites. Task 3 also gates the `serveStatic` mount on `import.meta.env.PROD`, because resolving from `import.meta.dirname` makes the dev-time root (`node_modules/.vite/hono-preact/../client`) reliably nonexistent, and `serveStatic` `existsSync`-checks its root at setup and logs to `console.error`. Without the gate the fix would print an error on every dev boot. Flag this in the PR body.
