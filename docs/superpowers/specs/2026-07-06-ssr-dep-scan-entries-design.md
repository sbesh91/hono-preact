# Dev SSR prerender crash: seed the SSR optimizer with route scan entries

Date: 2026-07-06
Status: Approved, pre-implementation

## Problem

In dev, the first request to a route whose module graph pulls in a dependency
not yet reachable from the SSR entry crashes the prerender with:

```
TypeError: Cannot read properties of undefined (reading '__H')
    at useEffect        (preact/hooks)
    at useHashScroll    (apps/site/src/hooks/use-hash-scroll.ts:30)
    at DocsLayout       (apps/site/src/components/DocsLayout.tsx:50)
    at ...preact-iso_prerender  (SSR)
```

`__H` is Preact's internal hook-state slot. The crash is not in the hook or the
component; both are ordinary. It reproduces deterministically:

| Condition | Result |
| --- | --- |
| Cold optimizer cache, first hit to `/docs/quick-start` | 500 (`__H`), can exit the dev process |
| Same server, warm (2nd/3rd hit) | 200 |
| `/` (never imports the late deps) | always 200 |

`apps/site`'s dev script is `vite --force`, which wipes the optimize-deps cache
on every start, so every restart re-arms the first-request crash. That is the
"getting the routes 500 again" recurrence.

## Root cause

The SSR (worker) environment's dep optimizer discovers `lucide-preact`,
`@floating-ui/dom`, and `preact/jsx-runtime` only when the first `/docs/*`
request renders (they sit behind the route views' dynamic imports and the docs
`import.meta.glob('./pages/docs/**/*.mdx')`, which the initial scan does not
crawl from the worker entry). On discovery Vite re-bundles and **re-hashes the
entire optimized-deps chunk** (`deps_hono_preact/*?v=NEW`) and issues
`[vite] program reload`.

`preact-iso`'s prerender is async: it `await`s lazy route chunks
(`Promise.all` in the trace). When the reload lands during that await, the
resumed chunk imports the *new-hash* `preact/hooks` while the render began under
the *old-hash* one. The two Preact instances do not share hook state, so the
current component is `undefined` and `.__H` throws. The framework already
`dedupe`s preact; this is a mid-render module-instance swap, not a duplicate in
the resolved graph.

Key consequence for the fix: pre-`include`-ing only the Preact runtime does not
help. As long as any *app* dependency is discovered at request time, the whole
optimized chunk re-hashes and the render still races the reload. The fix must
make **all** deps discoverable at server startup so no reload happens during a
request.

## Approach

Seed the SSR/worker environment's dep optimizer with the app's routes manifest
as an `optimizeDeps.entries` scan entry. Vite's esbuild scanner then crawls the
full route graph at startup: it follows the `() => import(...)` route views and
the docs content-glob into `DocsLayout` and the demo components, and pre-bundles
every dependency they reach (framework and app alike). No runtime discovery, no
mid-render reload, no `__H` crash. This is automatic for every app on the
framework, with no per-app dependency lists.

### Placement

A single new `configEnvironment(name)` hook on the existing
`hono-preact:config` plugin in `packages/vite/src/hono-preact.ts`, which already
has `routes` and `root` in scope:

```ts
configEnvironment(name) {
  if (name === 'client') return;
  return { optimizeDeps: { entries: [resolve(root, routes)] } };
}
```

`configEnvironment` is invoked once per environment with its name, so
`name !== 'client'` covers both the Node adapter's `ssr` environment and the
Cloudflare adapter's worker environment (named after the worker, e.g.
`hono_preact`) without the framework needing to know the adapter-specific env
name. It is strictly less code than duplicating a shared helper call in each
adapter, requires no addition to `HonoPreactAdapterContext`, and covers future
adapters for free.

The routes path is resolved against the Vite root once (`resolve(root, routes)`)
so the entry is absolute and independent of the optimizer's cwd assumptions.

### Rejected alternatives

- **Pre-`include` the framework Preact runtime only.** Insufficient: app-dep
  discovery still re-hashes the chunk and reloads mid-render. A false fix.
- **Make the prerender resilient to a mid-render reload** (keep Preact a stable
  singleton across optimize re-hashes). Correct in principle but a deep change
  to the render/module-runner seam for a dev-only symptom. Over-engineered.
- **Per-adapter shared helper.** The originally-approved placement. Functionally
  equivalent but more code and needs `routes` threaded into the adapter context;
  `configEnvironment` supersedes it. Retained only as the fallback below.

## Risks and validation

- **CF plugin clobbering `optimizeDeps.entries`.** Resolved. Verified the hook's
  injected entries are honored for the Cloudflare worker env: with the fix the
  worker optimizer pre-bundles the route-graph deps at startup and the crash is
  gone (see Validation below). The `configEnvironment` return merges with the CF
  plugin's own worker-env `optimizeDeps` rather than being overridden.
- **Scanner reach.** Confirmed. With `routes.ts` as an explicit scan entry, the
  esbuild scanner follows the route views' dynamic imports and the docs
  `import.meta.glob` down into the demo components, so `lucide-preact`,
  `@floating-ui/dom`, and `preact/jsx-runtime` are pre-bundled at startup. The CF
  plugin's default entry (the generated `server-entry.tsx`) does not reach them
  at apps/site scale, which is why the crash occurs without this fix.

## Validation

Proven by a controlled A/B on `apps/site` (the real reproduction), toggling only
the fix, full framework rebuild each side, `apps/site` optimizer cache cleared,
`vite --force`, first cold request to `/docs/quick-start`:

- **With fix:** 200, no `__H`, no late dep discovery.
- **Without fix:** 500, `__H` crash, `lucide-preact` / `@floating-ui/dom` /
  `preact/jsx-runtime` discovered late, triggering the mid-render reload.

Note on where the plugin loads from: `apps/site`'s Vite *config file* imports
`hono-preact/vite`, and Vite `resolve.alias` does not apply to a config file's
own imports, so the plugin resolves to the consolidated
`packages/hono-preact/dist/vite/…` (built by `consolidate.mjs`), not
`packages/vite/dist`. Any manual verification must rebuild the consolidated dist,
not just `@hono-preact/vite`.

## Testing

1. **Unit test** on the hook (automated regression guard): returns
   `{ optimizeDeps: { entries: [<abs routes>] } }` for a non-client env name and
   `undefined` for `'client'`. This pins the hook's mechanics deterministically.
2. **Manual A/B on `apps/site`** (see Validation): the authoritative end-to-end
   check. A synthetic minimal fixture was attempted as an automated cold-start
   guard and removed: the race only manifests at `apps/site` scale (shiki plus
   the full docs corpus plus the mdx `import.meta.glob`), where the CF plugin's
   default `server-entry` scan is incomplete. Small fixtures get their whole
   route graph pre-scanned regardless of the fix, so such a test passes with or
   without it (a tautology, not a guard). Reproducing the scale reliably risks a
   flaky test, so the manual A/B is the end-to-end verification of record.

## Out of scope

- The `vite --force` flag in `apps/site`'s dev script. It is orthogonal; the fix
  makes the first request safe regardless of whether the cache is cold.
- Production builds. The race is dev-only (the optimizer and its reload do not
  exist in the production build).
