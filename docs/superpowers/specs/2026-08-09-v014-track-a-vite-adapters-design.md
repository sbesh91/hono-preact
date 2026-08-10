# v0.14 Track A, batch 2: vite / adapters ergonomics (#319)

Status: approved, ready for planning
Issue: #319 `[09] Second-tier ergonomics batch: vite / adapters`
Milestone: v0.14

## Scope

#319 lists six bullets under the same "second tier, one batched PR" framing as
#318. Two of them are load-bearing design work rather than fixes, and the issue's
own rule says those get promoted to their own issues rather than forced into the
batch. This spec covers the four that survive that triage.

Two of the six premises had drifted since #260 was filed on 2026-07-20. Each is
noted where it applies. The line numbers in #319 itself are stale and should not
be trusted while implementing.

## In scope

### 1. Vite root resolution residue

**Premise mostly stale.** The `process.cwd()` vs `config.root` inconsistency the
bullet describes is largely fixed: `hono-preact.ts:123` holds a `resolvedRoot`
that `configPlugin.config` sets from `userConfig.root` (`:135`), and the `__H`
optimizer seed resolves the routes entry against it (`:208`). `server-entry.ts`
does the same independently in its own `config` hook (`:321-323`).

What survives is narrower and still real. `generatedCoreAppAbsPath()` and
`generatedEntryWrapperAbsPath()` are called at `honoPreact()` call time
(`hono-preact.ts:109-110`), before any Vite hook runs, so they bake in
`process.cwd()`. Under a custom Vite `root`, the generated core-app and entry
wrapper are written to `<cwd>/node_modules/.vite/hono-preact/` while every
consumer resolves against `<root>`. `ctx.root` (`:112`), the value handed to
every adapter through `HonoPreactAdapterContext`, is still raw `process.cwd()`
for the same reason.

An ordering constraint governs the fix and must not be "tidied": `serverEntryPlugin`
writes these files in its own `config` hook, deliberately (see the comment above
`server-entry.ts`'s `config`), so the entry wrapper exists on disk before
`@cloudflare/vite-plugin`'s `config` hook runs `fs.existsSync` on the
`wrangler.jsonc` `main` path. The paths therefore cannot move to `configResolved`.

**Plugin ordering rules out the obvious fix.** The tempting shape is for
`honoPreact()` to hand `serverEntryPlugin` a `getRoot()` thunk closing over
`resolvedRoot`, which `configPlugin.config` sets. That does not work: Vite sorts
`enforce: 'pre'` plugins ahead of unenforced ones, and `serverEntryPlugin` is
`enforce: 'pre'` while `configPlugin` is not. Verified empirically against this
repo's Vite via `resolveConfig` with instrumented `config` hooks; the observed
order is `hono-preact:server-entry`, then `hono-preact:config`, then the rest.
The thunk would read a stale `process.cwd()` every time. Do not reintroduce it.

Approach: `serverEntryPlugin` owns both paths. It already computes the resolved
root itself inside its own `config(userConfig)` hook (`server-entry.ts:321-323`),
so it derives `coreAppPath` and `entryWrapperPath` there via
`generatedCoreAppAbsPath(root)` / `generatedEntryWrapperAbsPath(root)` (both
already take a `cwd` parameter). The `coreAppPath` / `entryWrapperPath` options
drop off `ServerEntryPluginOptions`. This is self-contained and immune to plugin
order.

`ctx` is constructed before any hook runs and its `coreAppModuleId` /
`entryWrapperId` are read by adapters at `wrapEntry` / `vitePlugins` time, so the
three `ctx` fields (`root`, `coreAppModuleId`, `entryWrapperId`) become getters
over the same lazily-resolved root. `HonoPreactAdapterContext`'s public shape
(three `string` fields) is unchanged, so no adapter changes.

The root lives in one per-`honoPreact()`-call holder, not three call sites:

```ts
// resolveRoot(userConfig) -> path.resolve(userConfig.root) ?? process.cwd()
let root: string | undefined;
const setRoot = (userConfig: UserConfig) => (root ??= resolveRoot(userConfig));
const getRoot = () => root ?? process.cwd();
```

Both `configPlugin.config` and `serverEntryPlugin.config` call `setRoot`, so
whichever Vite runs first wins and the other is a no-op; every getter reads
`getRoot()`. The `?? process.cwd()` fallback covers the pre-hook window only (an
adapter reading `ctx` before any `config` hook), preserving today's behaviour
there rather than throwing.

Test: a plugin-level test that invokes the `config` hook with
`{ root: <tmpdir> }` and asserts the generated core-app and entry-wrapper files
land under that root, not under `process.cwd()`.

### 2. `HonoPreactCssOptions` defaults invisible in IDE hover

**Premise partly stale.** `HonoPreactOptions` already documents every default
with `@default` JSDoc (`hono-preact.ts:42-80`). Only `HonoPreactCssOptions`
(`:30-33`) still states its defaults in comment prose (`Default true (when
global is set)`, `Default 1024`).

Convert those two to `@default` tags so IDE hover surfaces them. Comment-only
change; no test.

### 3. Node adapter is cwd-sensitive

**Confirmed.** The wrapper `nodeAdapter().wrapEntry()` emits reads the client
build through two cwd-relative paths: `serveStatic({ root: './dist/client' })`
and `readFileSync('./dist/client/<preload manifest>')`. Both break whenever the
process starts from a directory other than the project root: a systemd unit
without `WorkingDirectory`, a Docker image with a different `WORKDIR`, or a
monorepo script invoked from the repo root.

The built server entry lands at `<root>/dist/server/` (`node-dev-server.ts:16,20`
set `dist/client` and `dist/server`), so the client directory is deterministically
`../client` relative to the server bundle. The emitted wrapper gains a single
`const __hpClientDir = join(import.meta.dirname, '../client')` and both sites read
from it.

`@hono/node-server`'s `serveStatic` passes `root` straight into `path.join(root,
filename)` (verified against 1.19.14), so an absolute root is supported; there is
no relative-path constraint to work around.

Dev is unaffected: the manifest read is already `import.meta.env.PROD`-gated, and
the dev server never runs the `serveStatic` middleware.

Test: extend the built half of `pnpm test:smoke`, which already boots the real
built entry, to run it from a cwd other than the project root and assert a
`/static/*` asset 200s. This defect is invisible to a unit test by construction
(it is a property of the emitted module's runtime cwd), which is the same class
of fault the smoke harness exists for.

### 4. `nodeAdapter({ devSsrInclude })`

**Confirmed.** `node-dev-server.ts:84` passes any path starting with `/@` or
`/node_modules/` to Vite's later middlewares, unconditionally. The prefixes are
correct for Vite internals (`/@fs`, `/@id`, the HMR client) but they also swallow
application routes: an app with a `/@:username` profile route never reaches SSR
in dev, while working correctly in production.

Add an opt-in escape hatch:

```ts
nodeAdapter({ devSsrInclude?: (string | RegExp)[] })
```

Patterns are matched **before** the built-in prefix check; a hit forces the
request to SSR. The built-in pass-through list stays as the default and is not
user-replaceable, so no app config can silently break HMR or module loading.

`exclude` is deliberately not shipped. The issue's wording borrows
`@hono/vite-dev-server`'s `exclude`, but an `exclude` that replaces the defaults
does not actually fix `/@username` without the user correctly re-typing both Vite
internal prefixes; the cost of getting that wrong is a broken dev server with a
confusing symptom. `include` fixes the reported case in one line and cannot regress the
default.

Matching rules: the request path is query-stripped first (the existing
`(req.url ?? '').split('?')[0]`). A string pattern matches by prefix; a RegExp
matches by `.test()`.

The matcher is a standalone exported pure function
(`shouldForceSsr(path: string, patterns: readonly (string | RegExp)[]): boolean`)
so it unit-tests without booting a dev server. Per the repo's test-the-caller
rule, it also needs one middleware-level test proving the wiring passes the real
query-stripped request path into it, since a passing matcher test says nothing
about the caller passing the right argument.

## Promoted out of the batch

Both are filed as their own v0.14 issues (#375, #376); neither is implemented here.

- **CF adapter ships the full realtime DO machinery unconditionally** (#375)
  (`adapter-cloudflare.ts`, the `wrapEntry` template). Gating it on room/socket
  detection, or providing an opt-out, changes what a deployed worker *contains*:
  the exported DO class, the wrangler migration, and the binding. Getting it
  wrong breaks an existing deployment's migration chain. This needs its own
  design covering detection (build-time registry scan vs explicit opt-out), what
  happens to an app that adds its first room after deploying an ungated worker,
  and the wrangler-config consequences.
- **`emitClientAsset(fileName, () => source)`** (#376). A new public Vite API. It needs
  a dev/build dual-path design (the dev server must serve what the build emits,
  which is exactly the split `apps/site/vite.config.ts` hand-rolls for
  `llms.txt`), a decision on source-vs-lazy-thunk evaluation timing, and a
  dogfood pass replacing the site's hand-rolled version.

## Non-goals

No change to the Cloudflare adapter. No new public Vite API. No `exclude` option
on `nodeAdapter()`. No change to the `dist/client` / `dist/server` output layout.
