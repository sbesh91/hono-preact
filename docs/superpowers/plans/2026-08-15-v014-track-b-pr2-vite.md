# v0.14 Track B, PR 2 (vite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `assets` option to `honoPreact()` that emits a generated file into the client build output and serves the same bytes in dev from one declaration, then replace the docs site's hand-rolled dual path with it.

**Architecture:** A new focused module in `packages/vite/src` owns both halves (build emit and dev middleware) so they cannot drift. `honoPreact()` reads the new `assets` option and registers the plugin. The build half uses Rollup's `emitFile` in the client environment; the dev half registers middleware ahead of the SSR catch-all and calls the thunk per request.

**Tech Stack:** Vite (Rollup / Rolldown plugin API), TypeScript, Vitest, Cloudflare Workers (ASSETS binding) and Node (`serveStatic`) for adapter parity.

**Spec:** `docs/superpowers/specs/2026-08-15-v014-track-b-design.md`

## Global Constraints

- Issue covered: #376.
- Additive only. No breaking changes in this PR.
- The API lands as a `honoPreact({ assets })` option, NOT a standalone exported plugin factory. This was an explicit maintainer decision over the standalone alternative.
- Evaluation timing differs deliberately between halves: the thunk is called EXACTLY ONCE during the build, and PER REQUEST in dev. Per-request dev evaluation is what makes edits appear without a dev-server restart.
- Thunks may be sync or async, and may return `string` or `Uint8Array`. Both halves await.
- Middleware ordering is the known hazard: `node-dev-server.ts` documents that registering in the returned post hook lands after `spaFallbackMiddleware` and 404s. The asset middleware MUST be registered in the pre-hook position, ahead of the SSR middleware.
- The change is NOT done until `apps/site/vite.config.ts` drops its hand-rolled `emit-llms-txt` plugin and uses `assets`. If the helper cannot express what the site already does, stop and revisit the design.
- `pnpm --filter <pkg> test` is a silent no-op. Run `pnpm exec vitest run <pattern>` from the repo root.
- No em-dashes in prose, comments, or commit messages.
- Work in a dedicated git worktree on a feature branch, not the primary checkout on `main`. Run `pnpm wt:setup` from inside the new worktree before the first task.
- Serena is bound to the primary checkout and is unavailable in a worktree. Use `rg` / Read / Edit there.

---

### Task 1: The `emitClientAsset` plugin module

**Files:**
- Create: `packages/vite/src/client-assets.ts`
- Test: `packages/vite/src/__tests__/client-assets.test.ts`

**Interfaces:**
- Consumes: Vite's `Plugin` type.
- Produces:
  - `export type ClientAssetSource = () => string | Uint8Array | Promise<string | Uint8Array>`
  - `export type ClientAssets = Record<string, ClientAssetSource>`
  - `export function emitClientAsset(assets: ClientAssets): Plugin`
  - `export function contentTypeFor(fileName: string): string`

Task 2 imports `emitClientAsset` and `ClientAssets` from this module.

- [ ] **Step 1: Write the failing content-type test**

Create `packages/vite/src/__tests__/client-assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { contentTypeFor } from '../client-assets.js';

describe('contentTypeFor', () => {
  it('maps known extensions', () => {
    expect(contentTypeFor('llms.txt')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('sw.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('manifest.webmanifest')).toBe('application/manifest+json');
    expect(contentTypeFor('data.json')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('feed.xml')).toBe('application/xml; charset=utf-8');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(contentTypeFor('thing.zzz')).toBe('application/octet-stream');
    expect(contentTypeFor('noext')).toBe('application/octet-stream');
  });

  it('is case-insensitive on the extension', () => {
    expect(contentTypeFor('LLMS.TXT')).toBe('text/plain; charset=utf-8');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/client-assets.test.ts`
Expected: FAIL, cannot resolve `../client-assets.js`.

- [ ] **Step 3: Implement the module**

Create `packages/vite/src/client-assets.ts`:

```ts
import type { Plugin } from 'vite';

/**
 * Produces the asset's bytes. Called EXACTLY ONCE during the build and PER
 * REQUEST in dev, so a dev edit shows up without a server restart while the
 * build stays deterministic. May be sync or async.
 */
export type ClientAssetSource = () =>
  | string
  | Uint8Array
  | Promise<string | Uint8Array>;

/** Output file name (relative to the client out dir) to its byte source. */
export type ClientAssets = Record<string, ClientAssetSource>;

const CONTENT_TYPES: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  xml: 'application/xml; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  svg: 'image/svg+xml',
};

/**
 * Content type from the file extension. Unknown extensions get
 * `application/octet-stream` rather than a guess: serving a wrong type is
 * worse than serving an opaque one.
 */
export function contentTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

// Normalizes a request path to the asset key: strips the query and the leading
// slash so `/llms.txt?v=2` matches the declared `llms.txt`.
function assetKeyFromUrl(url: string): string {
  const path = url.split('?')[0] ?? '';
  return path.startsWith('/') ? path.slice(1) : path;
}

/**
 * Registers both halves of a build-emitted, dev-served asset from one
 * declaration, so the two cannot drift.
 */
export function emitClientAsset(assets: ClientAssets): Plugin {
  const entries = Object.entries(assets);
  return {
    name: 'hono-preact:client-assets',

    // Emit into the CLIENT build only. The worker build shares no asset root,
    // and emitting there would put the file somewhere nothing serves it from.
    async generateBundle() {
      if (this.environment && this.environment.name !== 'client') return;
      for (const [fileName, source] of entries) {
        const value = await source();
        this.emitFile({
          type: 'asset',
          fileName,
          source: typeof value === 'string' ? value : Buffer.from(value),
        });
      }
    },

    configureServer(server) {
      // Registered in the PRE-hook position (the body of configureServer, not
      // the returned post hook). The post hook lands after spaFallbackMiddleware
      // and the SSR catch-all, which would 404 every asset path. See
      // node-dev-server.ts for the same hazard documented at its origin.
      server.middlewares.use((req, res, next) => {
        const key = assetKeyFromUrl(req.url || '');
        const source = assets[key];
        if (!source) {
          next();
          return;
        }
        // Called per request on purpose: regenerating on each hit is what makes
        // an edit visible without a dev-server restart, with no cache to
        // invalidate by hand.
        Promise.resolve(source())
          .then((value) => {
            res.setHeader('Content-Type', contentTypeFor(key));
            res.end(typeof value === 'string' ? value : Buffer.from(value));
          })
          .catch(next);
      });
    },
  };
}
```

- [ ] **Step 4: Run to verify the content-type tests pass**

Run: `pnpm exec vitest run packages/vite/src/__tests__/client-assets.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the dev-middleware tests**

Append to the same test file:

```ts
import { emitClientAsset } from '../client-assets.js';
import type { Plugin } from 'vite';
import { vi } from 'vitest';

type Handler = (req: any, res: any, next: (err?: unknown) => void) => void;

function devHandlerFor(plugin: Plugin): Handler {
  const handlers: Handler[] = [];
  const server = { middlewares: { use: (h: Handler) => handlers.push(h) } };
  (plugin.configureServer as any)(server);
  expect(handlers).toHaveLength(1);
  return handlers[0]!;
}

function fakeRes() {
  return {
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    end(b: unknown) { this.body = b; },
  };
}

describe('emitClientAsset dev half', () => {
  it('serves a declared asset with the right content type', async () => {
    const handler = devHandlerFor(emitClientAsset({ 'llms.txt': () => 'hello' }));
    const res = fakeRes();
    const next = vi.fn();
    handler({ url: '/llms.txt' }, res, next);
    await vi.waitFor(() => expect(res.body).toBeDefined());
    expect(res.body).toBe('hello');
    expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(next).not.toHaveBeenCalled();
  });

  it('calls the thunk PER REQUEST so dev edits appear without a restart', async () => {
    let n = 0;
    const handler = devHandlerFor(emitClientAsset({ 'llms.txt': () => `v${++n}` }));
    const r1 = fakeRes();
    handler({ url: '/llms.txt' }, r1, vi.fn());
    await vi.waitFor(() => expect(r1.body).toBeDefined());
    const r2 = fakeRes();
    handler({ url: '/llms.txt' }, r2, vi.fn());
    await vi.waitFor(() => expect(r2.body).toBeDefined());
    expect(r1.body).toBe('v1');
    expect(r2.body).toBe('v2');
    expect(n).toBe(2);
  });

  it('passes undeclared paths through to the next middleware', () => {
    const handler = devHandlerFor(emitClientAsset({ 'llms.txt': () => 'hello' }));
    const res = fakeRes();
    const next = vi.fn();
    handler({ url: '/some/page' }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBeUndefined();
  });

  it('ignores the query string when matching', async () => {
    const handler = devHandlerFor(emitClientAsset({ 'llms.txt': () => 'hello' }));
    const res = fakeRes();
    handler({ url: '/llms.txt?v=2' }, res, vi.fn());
    await vi.waitFor(() => expect(res.body).toBe('hello'));
  });

  it('supports async thunks and Uint8Array', async () => {
    const handler = devHandlerFor(
      emitClientAsset({ 'a.bin': async () => new Uint8Array([1, 2, 3]) })
    );
    const res = fakeRes();
    handler({ url: '/a.bin' }, res, vi.fn());
    await vi.waitFor(() => expect(res.body).toBeDefined());
    expect(Buffer.from(res.body as Buffer)).toEqual(Buffer.from([1, 2, 3]));
    expect(res.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('forwards a thunk failure to next() instead of hanging', async () => {
    const boom = new Error('generation failed');
    const handler = devHandlerFor(
      emitClientAsset({ 'llms.txt': () => { throw boom; } })
    );
    const next = vi.fn();
    handler({ url: '/llms.txt' }, fakeRes(), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(boom));
  });
});

describe('emitClientAsset build half', () => {
  function runGenerateBundle(plugin: Plugin, envName: string) {
    const emitted: Array<{ fileName: string; source: unknown }> = [];
    const ctx = {
      environment: { name: envName },
      emitFile: (f: any) => emitted.push({ fileName: f.fileName, source: f.source }),
    };
    return (plugin.generateBundle as any).call(ctx).then(() => emitted);
  }

  it('emits into the client build with the thunk bytes', async () => {
    const emitted = await runGenerateBundle(
      emitClientAsset({ 'llms.txt': () => 'built' }),
      'client'
    );
    expect(emitted).toEqual([{ fileName: 'llms.txt', source: 'built' }]);
  });

  it('emits nothing in a non-client environment', async () => {
    const emitted = await runGenerateBundle(
      emitClientAsset({ 'llms.txt': () => 'built' }),
      'ssr'
    );
    expect(emitted).toEqual([]);
  });

  it('calls each thunk exactly once during the build', async () => {
    let n = 0;
    await runGenerateBundle(emitClientAsset({ 'llms.txt': () => `v${++n}` }), 'client');
    expect(n).toBe(1);
  });

  it('emits root-level names unchanged, which is what /sw.js needs', async () => {
    const emitted = await runGenerateBundle(
      emitClientAsset({ 'sw.js': () => 'self.addEventListener()' }),
      'client'
    );
    expect(emitted[0]!.fileName).toBe('sw.js');
  });
});
```

- [ ] **Step 6: Run the full module test suite**

Run: `pnpm exec vitest run packages/vite/src/__tests__/client-assets.test.ts`
Expected: PASS, all tests.

Mutation-check the per-request assertion: temporarily memoize the thunk result in the dev middleware (call it once and cache), re-run, and confirm the "PER REQUEST" test FAILS. Revert.

- [ ] **Step 7: Commit**

```bash
git add packages/vite/src/client-assets.ts packages/vite/src/__tests__/client-assets.test.ts
git commit -m "feat(vite): emitClientAsset plugin for build-emitted, dev-served assets (#376)"
```

---

### Task 2: Wire `assets` into `honoPreact()`

**Files:**
- Modify: `packages/vite/src/hono-preact.ts` (the options type and the returned plugin array)
- Modify: `packages/vite/src/index.ts` (export the public types)
- Test: `packages/vite/src/__tests__/hono-preact-assets.test.ts`

**Interfaces:**
- Consumes: `emitClientAsset`, `ClientAssets` from `./client-assets.js`.
- Produces: `assets?: ClientAssets` on `honoPreact()`'s options. `ClientAssets` and `ClientAssetSource` are exported from `hono-preact/vite`.

- [ ] **Step 1: Read the current options type and plugin assembly**

```bash
rg -n "export function honoPreact|Options|plugins" packages/vite/src/hono-preact.ts | head -30
```

Note the exact options interface name and how the returned `Plugin[]` is assembled, so the new entry follows the existing pattern.

- [ ] **Step 2: Write the failing test**

Create `packages/vite/src/__tests__/hono-preact-assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { honoPreact } from '../hono-preact.js';

describe('honoPreact({ assets })', () => {
  it('registers the client-assets plugin when assets are declared', () => {
    const plugins = honoPreact({ assets: { 'llms.txt': () => 'x' } });
    const names = plugins.map((p) => p && (p as { name?: string }).name);
    expect(names).toContain('hono-preact:client-assets');
  });

  it('registers no client-assets plugin when assets are omitted', () => {
    const plugins = honoPreact({});
    const names = plugins.map((p) => p && (p as { name?: string }).name);
    expect(names).not.toContain('hono-preact:client-assets');
  });
});
```

If `honoPreact` returns a nested or async plugin structure, flatten it in the test to match the real shape rather than changing the production return type.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec vitest run packages/vite/src/__tests__/hono-preact-assets.test.ts`
Expected: FAIL. `assets` is not a known option and the plugin is absent.

- [ ] **Step 4: Add the option and register the plugin**

In `packages/vite/src/hono-preact.ts`, add to the options interface:

```ts
  /**
   * Generated files emitted into the client build and served from the same
   * thunk in dev, so the two halves cannot drift. Keyed by output file name
   * relative to the client out dir, so `'llms.txt'` serves at `/llms.txt`.
   *
   * The thunk runs once during the build and per request in dev, which is what
   * makes a dev edit appear without restarting the server.
   */
  assets?: ClientAssets;
```

Import at the top:

```ts
import { emitClientAsset, type ClientAssets } from './client-assets.js';
```

Register conditionally in the returned plugin array, following the file's existing conditional-plugin pattern:

```ts
    ...(options.assets ? [emitClientAsset(options.assets)] : []),
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run packages/vite/src/__tests__/hono-preact-assets.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Export the public types**

In `packages/vite/src/index.ts`, add:

```ts
export type { ClientAssets, ClientAssetSource } from './client-assets.js';
```

Do NOT export `emitClientAsset` itself: the agreed public surface is the `assets` option, and exporting both would create two documented spellings of one capability.

- [ ] **Step 7: Verify the export surface test**

Run: `pnpm exec vitest run packages/vite/src/__tests__/`
Expected: PASS. If an export-surface test asserts an exact list, add the two type names to it in this commit.

- [ ] **Step 8: Commit**

```bash
git add packages/vite/src/hono-preact.ts packages/vite/src/index.ts \
        packages/vite/src/__tests__/hono-preact-assets.test.ts
git commit -m "feat(vite): honoPreact({ assets }) option (#376)"
```

---

### Task 3: Dogfood in `apps/site` (the completion gate)

**Files:**
- Modify: `apps/site/vite.config.ts` (delete the `emit-llms-txt` plugin object, add `assets`)

The spec is explicit: the change is not done until the site drops its hand-rolled dual path. If the helper cannot express what the site already does, stop and revisit the design rather than working around it.

- [ ] **Step 1: Capture the current behavior as a baseline**

```bash
pnpm --filter site build
ls -la apps/site/dist/client/llms.txt apps/site/dist/client/llms-full.txt
shasum apps/site/dist/client/llms.txt apps/site/dist/client/llms-full.txt
```

Record both checksums. The post-change build must produce byte-identical files.

- [ ] **Step 2: Replace the hand-rolled plugin**

In `apps/site/vite.config.ts`, delete the entire inline plugin object named `'emit-llms-txt'` (its `closeBundle` half, its `configureServer` half, the `cache` variable, and the `server.watcher.on` invalidation). Move the `assets` declaration onto the existing `honoPreact(...)` call:

```ts
    honoPreact({
      adapter: cloudflareAdapter(),
      css: { global: 'src/styles/root.css' },
      assets: {
        // Generated per request in dev, so a docs edit is reflected with no
        // restart and no cache to invalidate by hand.
        'llms.txt': () => generateLlmsFiles(nav, docsDir).llmsTxt,
        'llms-full.txt': () => generateLlmsFiles(nav, docsDir).llmsFullTxt,
      },
    }),
```

Then remove imports that are now unused: `writeFileSync`, `mkdirSync`, and `resolve` / `readFileSync` ONLY if nothing else in the file uses them. `resolve` and `readFileSync` are used elsewhere in this config (the alias list and the version badge), so verify before deleting any import.

- [ ] **Step 3: Verify the built output is byte-identical**

```bash
pnpm --filter site build
shasum apps/site/dist/client/llms.txt apps/site/dist/client/llms-full.txt
```

Expected: checksums match Step 1 exactly. A difference means the emit path changed the bytes and must be investigated, not accepted.

- [ ] **Step 4: Verify the dev half serves the same bytes**

Start the dev server, then confirm both paths return real content and the right type. Per the repo's convention, verify the URL is reachable rather than merely emitted.

```bash
pnpm --filter site dev &
sleep 8
curl -si http://localhost:5173/llms.txt | head -5
curl -s http://localhost:5173/llms.txt | head -3
curl -s http://localhost:5173/llms-full.txt | head -3
kill %1
```

Expected: HTTP 200, `Content-Type: text/plain; charset=utf-8`, and real docs content, NOT the SSR not-found page. Adjust the port if the site dev server uses a different one.

- [ ] **Step 5: Confirm dev live-updates without a restart**

With the dev server running, edit any `.mdx` file under `apps/site/src/pages/docs/`, then re-request `/llms-full.txt` and confirm the change is reflected without restarting. This is the behavior per-request evaluation buys, and it is why the site no longer needs its watcher invalidation.

Revert the docs edit afterward.

- [ ] **Step 6: Commit**

```bash
git add apps/site/vite.config.ts
git commit -m "refactor(site): serve llms.txt through honoPreact({ assets }) (#376)"
```

---

### Task 4: Adapter parity verification

The spec requires confirming a plain emitted file is served identically under Cloudflare (ASSETS binding) and Node (`serveStatic`), and that a root-level name like `/sw.js` needs no adapter-specific handling. That second point is what unblocks #340 (PWA).

- [ ] **Step 1: Verify the Cloudflare path**

`apps/site` already uses `cloudflareAdapter()`, and `/llms.txt` is proven in production today. Confirm the built worker still serves it:

```bash
pnpm --filter site build
pnpm --filter site preview &
sleep 10
curl -si http://localhost:8788/llms.txt | head -5
kill %1
```

Expected: HTTP 200 with the text content. Adjust the port to whatever the site's preview script uses.

- [ ] **Step 2: Verify the Node path**

Add an `assets` declaration to `apps/example-node`'s Vite config, build it, and confirm the file serves through `serveStatic`:

```ts
      assets: { 'parity-check.txt': () => 'node adapter parity' },
```

```bash
pnpm --filter example-node build
# start the built server per that app's start script, then:
curl -si http://localhost:3000/parity-check.txt | head -5
```

Expected: HTTP 200, `text/plain; charset=utf-8`, body `node adapter parity`.

Revert the example-node config change once verified; it is a probe, not a shipped feature.

- [ ] **Step 3: Verify root-level `/sw.js` emission**

This is #340's gate. Temporarily add to the site config:

```ts
      'sw.js': () => 'self.addEventListener("install", () => {});',
```

Build and confirm the file lands at the client output root and serves from `/sw.js`:

```bash
pnpm --filter site build
ls -la apps/site/dist/client/sw.js
```

Expected: the file exists at the root of `dist/client`, not nested under an assets subdirectory. Record the result for #340, then revert the temporary declaration.

- [ ] **Step 4: Commit any test additions**

If Steps 1-3 produced permanent tests rather than throwaway probes, commit them. If they were probes, confirm the tree is clean:

```bash
git status --porcelain
```

---

### Task 5: Documentation

**Files:**
- Modify: the `honoPreact()` options reference page under `apps/site/src/pages/docs/`

- [ ] **Step 1: Find the options reference page**

```bash
rg -ln "honoPreact\(" apps/site/src/pages/docs/
```

- [ ] **Step 2: Document the `assets` option**

Add a section covering:

````mdx
```ts
honoPreact({
  adapter: cloudflareAdapter(),
  assets: {
    'llms.txt': () => renderLlmsTxt(),
  },
});
```
````

State plainly: keys are output file names relative to the client out dir, so `'llms.txt'` serves at `/llms.txt`; the thunk runs once during the build and per request in dev, so a dev edit appears without a restart; thunks may be async and may return a string or a `Uint8Array`; and a root-level name emits at the client root, which is what a service worker at `/sw.js` needs.

Docs describe what is. Do not narrate that this replaces a hand-rolled pattern.

Naming `ClientAssets` or `ClientAssetSource` in a code span opts in ALL their members to the docs coverage gate, so either document every member or refer to the shape inline without naming the type.

- [ ] **Step 3: Build the site and run the coverage gate**

Run: `pnpm --filter site build`
Then: `pnpm exec vitest run apps/site/src/__tests__/framework-coverage.test.ts`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs
git commit -m "docs: honoPreact({ assets }) option"
```

---

### Task 6: Full pre-push verification and PR

- [ ] **Step 1: Run the nine CI steps in order**

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

- [ ] **Step 2: Run the smoke suite locally**

This PR changes dev-server middleware ordering and build output, which is exactly the module-graph and build-pipeline fault class unit tests cannot reproduce. The spec marks smoke as required before merge for this PR.

Run: `pnpm test:smoke`
Expected: PASS for both adapters, dev and built.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin <branch>
gh pr create --title "v0.14 Track B batch 2: honoPreact({ assets }) for build-emitted, dev-served assets (#376)" --body "<body>"
```

The body should note the dogfood result (site `llms.txt` / `llms-full.txt` byte-identical before and after), the adapter parity results from Task 4, and the `/sw.js` root-emission result that unblocks #340.

- [ ] **Step 4: Add the `run-smoke` label**

Required before merge per `REVIEW.md`. If the label does not exist in the repo yet, create it first.

- [ ] **Step 5: Run the deep PR review**

Per `CLAUDE.md`, this is the immediate first follow-up to opening the PR. Follow `REVIEW.md`.

- [ ] **Step 6: Comment on #340**

Record the `/sw.js` root-emission result on #340, since that issue is explicitly gated on this question.
