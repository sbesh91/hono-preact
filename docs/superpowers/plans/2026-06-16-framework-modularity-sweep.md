# Framework Modularity Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the deferred modularity-polish backlog (GitHub issues #24, #25, #26, #27, #29, #31) as one behavior-preserving sweep PR, and close #28 (already resolved in code).

**Architecture:** Six independent refactors across `packages/iso`, `packages/vite`, and `packages/server`. Five are pure structure/DRY moves verified by the existing test suites; one (#26) is a deliberate, additive DX behavior change (collect-all validation errors instead of throw-on-first). Each task is independently reviewable and committed on its own.

**Tech Stack:** TypeScript, Vite plugin (`@babel/parser`/`@babel/traverse`/`magic-string`), Preact, Vitest (happy-dom), pnpm workspace.

---

## Pre-flight (run once before Task 1)

- [ ] **Create the feature branch**

```bash
git checkout -b refactor/modularity-sweep
git status   # confirm clean, on the new branch
```

- [ ] **Confirm the baseline is green** (so any later failure is attributable to this work)

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm test
```
Expected: build succeeds; all unit tests pass.

---

## Context the implementer needs

- **Verified current state (2026-06-16):** Issue **#28 is already done** — `packages/server/src/route-server-modules.ts` already returns `manifest.serverImports` directly (no stringified-int-key record). It needs only a `gh issue close`, handled in the wrap-up. Issue **#30 is already closed** (the shared `SERVER_EXPORT_KINDS` contract shipped as `server-exports-contract.ts`).
- **`packages/vite/src/server-only.ts` is already partially decomposed** since the original issue was filed: `parseServerLoaders`/`readParamsOpt` live in `server-loaders-parser.ts`, `deriveModuleKey` in `module-key.ts`, `BABEL_PARSER_PLUGINS` in `parser-options.ts`, `RECOGNIZED_SERVER_EXPORTS` in `server-exports-contract.ts`. Task 4 finishes the split; it does **not** re-extract those.
- **Test command:** `pnpm test` (root) runs every package's Vitest suite. To target one file: `pnpm exec vitest run <path>`.
- **No em-dashes** in code comments or commit messages (project rule). Use commas/colons/parentheses.
- **CLAUDE.md "Type casts" rule:** prefer reshaping types over `as`. Tasks below avoid introducing new casts.
- After every task, the changed files must pass `pnpm format:check` (run `pnpm format` if not). This is the single most-missed CI step.

---

## File Structure

**Modified:**
- `packages/iso/src/define-routes.tsx` — add `joinRoutePath` helper (Task 1); replace inline `validate` with a `Rule[]` table + collect-all (Task 2).
- `packages/iso/src/define-loader.ts` — remove `ViewRenderer`, import it instead (Task 3).
- `packages/vite/src/server-only.ts` — keep only `serverOnlyPlugin` + the transform pipeline; import the extracted helpers (Task 4).
- `packages/vite/package.json` — add `@babel/traverse` dep (Task 5).
- `packages/iso/src/internal/loader-fetch.ts` — reshape `fetchLoaderData` to return `{ first, subscribe }` (Task 6).
- `packages/iso/src/internal/loader-stub.ts`, `packages/iso/src/internal/loader-runner.ts` — update the two consumers (Task 6).

**Created:**
- `packages/iso/src/internal/view-renderer.tsx` — `ViewRenderer` (Task 3).
- `packages/vite/src/ast-walkers.ts` — `findDynamicServerImports`, `DynamicServerImport`, `isServerImport` (Task 4; `findDynamicServerImports` rewritten in Task 5).
- `packages/vite/src/source-extraction.ts` — `readSourceWithExtensionFallback`, `extractServerLoadersMeta` (Task 4).
- `packages/vite/src/stub-templates.ts` — `loaderStubSource`, `actionStubSource` (Task 4).

**Test files touched:** `packages/iso/src/__tests__/define-routes.test.tsx` (Task 2), `packages/iso/src/internal/__tests__/loader-fetch.test.ts` + `loader-fetch-timeout.test.ts` (Task 6). Existing vite suites (`server-only-plugin.test.ts`, `server-only-server-loaders.test.ts`, `build-bundle-leak.test.ts`, `server-entry.test.ts`) are the safety net for Tasks 4 and 5 and must stay green unchanged.

---

## Task 1: Extract `joinRoutePath` helper (#25)

**Files:**
- Modify: `packages/iso/src/define-routes.tsx`

The identical join `parentPath === '' ? r.path : parentPath + (r.path === '' ? '' : '/' + r.path)` appears verbatim in `collectServerRoutes` (as `pp`), `collectRouteUse`, and `flattenTree`. Extract it. Leave `validate` (line ~126, always-leading-slash display path) and `buildInnerRoutes` (line ~463, `child.path + '/' + grand.path`) alone: their join rules genuinely differ.

This is a pure refactor producing byte-identical output, so the existing `define-routes` tests are the verification (no new test).

- [ ] **Step 1: Add the helper** just above `function validate(` (line ~124)

```tsx
// Join a parent route path with a child segment, mirroring the tree walk:
// a root parent ('') yields the child as-is; an empty child segment (a
// layout-group wildcard leaf) contributes nothing; otherwise the child is
// appended under a single '/'. Shared by the tree walkers that need a node's
// absolute path. `validate` and `buildInnerRoutes` intentionally keep their
// own join rules (display-path with leading slash, and grandchild prefixing).
function joinRoutePath(parentPath: string, childPath: string): string {
  if (parentPath === '') return childPath;
  return childPath === '' ? parentPath : parentPath + '/' + childPath;
}
```

- [ ] **Step 2: Use it in `collectServerRoutes`**

Replace (line ~193):
```tsx
      const here =
        pp === '' ? r.path : pp + (r.path === '' ? '' : '/' + r.path);
```
with:
```tsx
      const here = joinRoutePath(pp, r.path);
```

- [ ] **Step 3: Use it in `collectRouteUse`**

Replace (line ~225):
```tsx
    const here =
      parentPath === ''
        ? r.path
        : parentPath + (r.path === '' ? '' : '/' + r.path);
```
with:
```tsx
    const here = joinRoutePath(parentPath, r.path);
```

- [ ] **Step 4: Use it in `flattenTree`**

Replace (line ~488):
```tsx
    const here =
      parentPath === ''
        ? r.path
        : parentPath + (r.path === '' ? '' : '/' + r.path);
```
with:
```tsx
    const here = joinRoutePath(parentPath, r.path);
```

- [ ] **Step 5: Run the iso route tests, confirm no regression**

Run: `pnpm exec vitest run packages/iso/src/__tests__/define-routes.test.tsx packages/iso/src/__tests__/define-routes-server.test.tsx packages/iso/src/__tests__/server-route.test.ts`
Expected: PASS (identical output, no behavior change).

- [ ] **Step 6: Format + commit**

```bash
pnpm format
git add packages/iso/src/define-routes.tsx
git commit -m "refactor(iso): extract joinRoutePath helper in define-routes (#25)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Validation rules as a structured table + collect-all errors (#26)

**Files:**
- Modify: `packages/iso/src/define-routes.tsx` (the `validate` function, lines ~124-161)
- Test: `packages/iso/src/__tests__/define-routes.test.tsx`

Convert the 5 inline `if`-throws into a `RouteRule[]` table and report **all** violations across the tree in one throw, instead of throwing on the first. Single-violation configs must still throw the **exact original message** so the existing `.toThrow(/.../)` assertions keep passing.

- [ ] **Step 1: Write the failing test** for the new multi-error behavior. Append to `packages/iso/src/__tests__/define-routes.test.tsx` (inside the top-level `describe`, after the existing validate tests):

```tsx
  it('reports all route configuration errors at once', () => {
    let message = '';
    try {
      defineRoutes([
        { path: '/', view: noopView, layout: noopLayout },
        { path: '/about', view: noopView, children: [{ path: 'x', view: noopView }] },
      ]);
    } catch (e) {
      message = (e as Error).message;
    }
    // Both violations surface in a single throw.
    expect(message).toMatch(/cannot declare both `view` and `layout`/);
    expect(message).toMatch(/`view` route cannot have `children`/);
    expect(message).toMatch(/2 route configuration errors/);
  });

  it('throws the bare single message when only one rule is violated', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, layout: noopLayout }])
    ).toThrow(/^Route \/: cannot declare both `view` and `layout`\.$/);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/__tests__/define-routes.test.tsx -t "reports all route configuration errors"`
Expected: FAIL (current `validate` throws on the first violation, so the second message is absent).

- [ ] **Step 3: Replace the `validate` implementation.** Swap the whole `function validate(...) { ... }` block (lines ~124-161) for:

```tsx
type RouteRuleCtx = {
  hasView: boolean;
  hasLayout: boolean;
  hasChildren: boolean;
  isNested: boolean;
};

// Each rule is a predicate over a node's shape plus a message factory. The
// table form lets `validate` collect every violation in one pass (better DX
// than throw-on-first) and keeps the rule set independently testable. Messages
// are byte-identical to the previous inline throws so single-violation configs
// surface the same text.
const ROUTE_RULES: ReadonlyArray<{
  when: (r: RouteDef, ctx: RouteRuleCtx) => boolean;
  message: (here: string) => string;
}> = [
  {
    when: (_r, c) => c.hasView && c.hasLayout,
    message: (here) =>
      `Route ${here}: cannot declare both \`view\` and \`layout\`.`,
  },
  {
    when: (_r, c) => c.hasView && c.hasChildren,
    message: (here) => `Route ${here}: \`view\` route cannot have \`children\`.`,
  },
  {
    when: (_r, c) => c.hasLayout && !c.hasChildren,
    message: (here) => `Route ${here}: \`layout\` requires \`children\`.`,
  },
  {
    when: (_r, c) => !c.hasView && !c.hasLayout && !c.hasChildren,
    message: (here) =>
      `Route ${here}: must declare \`view\`, \`layout\`+\`children\`, or \`children\`.`,
  },
  {
    when: (r, c) => c.isNested && r.path.startsWith('/'),
    message: (here) => `Route ${here}: child path must not start with \`/\`.`,
  },
];

function collectRouteViolations(
  routes: ReadonlyArray<RouteDef>,
  parentPath: string,
  errors: string[]
): void {
  for (const r of routes) {
    const here = parentPath + (r.path.startsWith('/') ? r.path : '/' + r.path);
    const ctx: RouteRuleCtx = {
      hasView: !!r.view,
      hasLayout: !!r.layout,
      hasChildren: !!(r.children && r.children.length > 0),
      isNested: parentPath !== '',
    };
    for (const rule of ROUTE_RULES) {
      if (rule.when(r, ctx)) errors.push(rule.message(here));
    }
    if (ctx.hasChildren) {
      collectRouteViolations(r.children!, here === '/' ? '' : here, errors);
    }
  }
}

function validate(routes: ReadonlyArray<RouteDef>): void {
  const errors: string[] = [];
  collectRouteViolations(routes, '', errors);
  if (errors.length === 0) return;
  if (errors.length === 1) throw new Error(errors[0]);
  throw new Error(
    `defineRoutes: ${errors.length} route configuration errors:\n` +
      errors.map((e) => `  - ${e}`).join('\n')
  );
}
```

Note: the `parentPath = ''` default on the old `validate` signature is dropped because `defineRoutes` calls `validate(tree)` with no second arg and the recursion now lives in `collectRouteViolations`. Confirm the only caller is `defineRoutes` (line ~526) and passes a single arg.

- [ ] **Step 4: Run the new test + the full validate suite**

Run: `pnpm exec vitest run packages/iso/src/__tests__/define-routes.test.tsx`
Expected: PASS, including every pre-existing `.toThrow(/.../)` assertion (single-violation cases throw the bare original message) and the two new tests.

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add packages/iso/src/define-routes.tsx packages/iso/src/__tests__/define-routes.test.tsx
git commit -m "refactor(iso): table-driven route validation with collect-all errors (#26)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Move `ViewRenderer` into `internal/view-renderer.tsx` (#29)

**Files:**
- Create: `packages/iso/src/internal/view-renderer.tsx`
- Modify: `packages/iso/src/define-loader.ts` (remove the local `ViewRenderer`, lines ~137-151; import instead)

`ViewRenderer` only reads contexts (`LoaderDataContext`/`LoaderErrorContext` via `loaderRef.useData()`/`useError()`, and `ReloadContext`). It belongs next to its context deps. It is not exported and is referenced only inside `define-loader.ts`'s `View`, so this is a mechanical move verified by the existing loader tests.

- [ ] **Step 1: Create `packages/iso/src/internal/view-renderer.tsx`**

```tsx
import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { LoaderRef } from '../define-loader.js';
import { ReloadContext } from '../reload-context.js';

// Reads the loader's resolved data/error from context and the active reload
// callback, then hands them to the consumer's render function. Lives here,
// next to its context dependencies, rather than in define-loader.ts (which
// stays focused on LoaderRef construction).
export function ViewRenderer<T>({
  loaderRef,
  props,
  render,
}: {
  loaderRef: LoaderRef<T>;
  props: Record<string, unknown>;
  render: (args: any) => ComponentChildren;
}) {
  const data = loaderRef.useData();
  const error = loaderRef.useError();
  const reloadCtx = useContext(ReloadContext);
  const reload = reloadCtx?.reload ?? (() => {});
  return render({ data, error, reload, ...props });
}
```

- [ ] **Step 2: Delete the local `ViewRenderer`** from `define-loader.ts` (the whole `function ViewRenderer<T>(...) { ... }` block, lines ~137-151).

- [ ] **Step 3: Add the import** in `define-loader.ts`. After the existing `import { ReloadContext } from './reload-context.js';` line (~14), add:

```ts
import { ViewRenderer } from './internal/view-renderer.js';
```

- [ ] **Step 4: Remove the now-unused imports** in `define-loader.ts` if they are no longer referenced after the move. Check `useContext` (still used by `useData`/`useError` in the ref — KEEP) and `ReloadContext` (now only used in `view-renderer.tsx` — REMOVE its import from `define-loader.ts` if grep shows no other use).

Run: `rg -n "ReloadContext|useContext" packages/iso/src/define-loader.ts`
If `ReloadContext` has no remaining references, delete its import line. `useContext` stays.

- [ ] **Step 5: Run the loader tests**

Run: `pnpm exec vitest run packages/iso/src/__tests__/define-loader.test.ts packages/iso/src/__tests__/loader-middleware.test.tsx packages/iso/src/__tests__/define-loader-use.test.tsx packages/iso/src/internal/__tests__/loader-stub.test.ts`
Expected: PASS (no behavior change; `View` renders identically).

- [ ] **Step 6: Format + commit**

```bash
pnpm format
git add packages/iso/src/internal/view-renderer.tsx packages/iso/src/define-loader.ts
git commit -m "refactor(iso): move ViewRenderer into internal/view-renderer (#29)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Split `server-only.ts` into focused modules (#24)

**Files:**
- Create: `packages/vite/src/ast-walkers.ts`, `packages/vite/src/source-extraction.ts`, `packages/vite/src/stub-templates.ts`
- Modify: `packages/vite/src/server-only.ts` (import the extracted helpers; keep only the plugin + transform pipeline)

Pure code move. `server-only.ts` currently mixes AST walking, source-text mining, stub-source generation, and the transform pipeline. Extract the first three; the existing vite suites are the safety net. Do **not** change behavior, identifiers, or message text.

- [ ] **Step 1: Create `packages/vite/src/ast-walkers.ts`** with the AST helpers (moved verbatim from `server-only.ts`):

```ts
import type { ImportDeclaration } from '@babel/types';

export type DynamicServerImport = { start: number; end: number; source: string };

export function findDynamicServerImports(
  node: unknown,
  found: DynamicServerImport[]
): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) findDynamicServerImports(child, found);
    return;
  }
  const n = node as {
    type?: string;
    callee?: { type?: string };
    arguments?: Array<{ type?: string; value?: string }>;
    start?: number;
    end?: number;
  };
  if (
    n.type === 'CallExpression' &&
    n.callee?.type === 'Import' &&
    n.arguments?.[0]?.type === 'StringLiteral' &&
    typeof n.arguments[0].value === 'string' &&
    /\.server(\.[jt]sx?)?$/.test(n.arguments[0].value)
  ) {
    found.push({
      start: n.start!,
      end: n.end!,
      source: n.arguments[0].value,
    });
  }
  for (const key of Object.keys(node as object)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'trailingComments'
    )
      continue;
    findDynamicServerImports((node as Record<string, unknown>)[key], found);
  }
}

export const isServerImport = (node: unknown): node is ImportDeclaration =>
  (node as ImportDeclaration).type === 'ImportDeclaration' &&
  /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value);
```

- [ ] **Step 2: Create `packages/vite/src/source-extraction.ts`** with the source-mining helpers (moved verbatim):

```ts
import * as fs from 'node:fs';
import { parse } from '@babel/parser';
import { parseServerLoaders, readParamsOpt } from './server-loaders-parser.js';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

// TypeScript NodeNext convention: source code imports `.server.js` even though
// the file on disk is `.server.ts` (or .tsx). Try the literal path first
// (handles plain `.js` cases), then the TS-extension swaps.
export function readSourceWithExtensionFallback(
  absServerPath: string
): string | null {
  const tries = [
    absServerPath,
    absServerPath.replace(/\.js$/, '.ts'),
    absServerPath.replace(/\.jsx$/, '.tsx'),
  ];
  for (const p of tries) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      // try next candidate
    }
  }
  return null;
}

// Reads a .server.* file synchronously and extracts the `params` option from
// each entry in the `serverLoaders` ObjectExpression. Returns a map of
// { loaderName -> params } for loaders that declare non-default params, or an
// empty object if the file cannot be parsed or has no serverLoaders.
export function extractServerLoadersMeta(
  absServerPath: string
): Record<string, string[] | '*'> {
  const src = readSourceWithExtensionFallback(absServerPath);
  if (src == null) return {};

  let ast;
  try {
    ast = parse(src, {
      sourceType: 'module',
      plugins: BABEL_PARSER_PLUGINS,
      errorRecovery: true,
    });
  } catch {
    return {};
  }

  const entries = parseServerLoaders(ast.program);
  const meta: Record<string, string[] | '*'> = {};
  for (const entry of entries) {
    if (!entry.optsArg) continue;
    const params = readParamsOpt(entry.optsArg);
    if (params !== undefined) meta[entry.name] = params;
  }

  return meta;
}
```

- [ ] **Step 3: Create `packages/vite/src/stub-templates.ts`** with the stub-source builders (the inline template strings extracted into named functions):

```ts
import {
  MODULE_KEY_EXPORT,
  LOADER_NAME_OPTION,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
} from '@hono-preact/iso/internal/runtime';

// Source for the `serverLoaders` client stub: a Proxy whose every property read
// constructs a fresh loader stub carrying the module key, loader name, and the
// statically-mined params for that loader.
export function loaderStubSource(
  localName: string,
  moduleKey: string,
  loadersMeta: Record<string, string[] | '*'>
): string {
  const metaVar = `__$serverLoadersMeta_${localName}`;
  const metaJson = JSON.stringify(loadersMeta);
  return (
    `const ${metaVar} = ${metaJson};\n` +
    `const ${localName} = new Proxy({}, {\n` +
    `  get(_, name) {\n` +
    `    const __meta = ${metaVar}[String(name)];\n` +
    `    return __$createLoaderStub_hpiso({\n` +
    `      ${MODULE_KEY_EXPORT}: ${JSON.stringify(moduleKey)},\n` +
    `      ${LOADER_NAME_OPTION}: String(name),\n` +
    `      params: __meta,\n` +
    `    });\n` +
    `  }\n` +
    `});`
  );
}

// Source for the `serverActions` client stub. Each `serverActions.<name>` read
// constructs a fresh descriptor record (module + action), so the stub is not a
// stable singleton; callers that key a Map on the stub will be surprised. The
// contract is "stubs are descriptor records, not singletons."
export function actionStubSource(localName: string, moduleKey: string): string {
  return (
    `const ${localName} = new Proxy({}, {\n` +
    `  get(_, action) {\n` +
    `    const stub = { ${FORM_MODULE_FIELD}: ${JSON.stringify(moduleKey)}, ${FORM_ACTION_FIELD}: String(action) };\n` +
    `    stub.useAction = (opts) => __$useAction_hpiso(stub, opts);\n` +
    `    return stub;\n` +
    `  }\n` +
    `});`
  );
}
```

- [ ] **Step 4: Rewire `server-only.ts`.** Remove the moved code (the `DynamicServerImport` type, `findDynamicServerImports`, `readSourceWithExtensionFallback`, `extractServerLoadersMeta`, the inline `isServerImport` closure, and the two inline stub template strings) and import the extracted symbols. Update the imports block near the top:

Remove these now-unused imports from `server-only.ts` (they moved into the new files):
```ts
import * as fs from 'node:fs';
import type { ImportDeclaration } from '@babel/types';
import {
  MODULE_KEY_EXPORT,
  LOADER_NAME_OPTION,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
} from '@hono-preact/iso/internal/runtime';
import { deriveModuleKey } from './module-key.js';
import { parseServerLoaders, readParamsOpt } from './server-loaders-parser.js';
```
Keep `MODULE_KEY_EXPORT` only if it is still referenced (it is, in the dynamic-import stub at line ~302). So the precise edit: keep `import { MODULE_KEY_EXPORT } from '@hono-preact/iso/internal/runtime';`, keep `import { deriveModuleKey } from './module-key.js';` (still used at lines ~203, ~300), drop `parseServerLoaders`/`readParamsOpt` (moved), drop `fs` and `ImportDeclaration` and `FORM_*`/`LOADER_NAME_OPTION` (moved).

Add the new imports:
```ts
import {
  findDynamicServerImports,
  isServerImport,
  type DynamicServerImport,
} from './ast-walkers.js';
import { extractServerLoadersMeta } from './source-extraction.js';
import { loaderStubSource, actionStubSource } from './stub-templates.js';
```

In the transform body, replace the inline `serverLoaders` stub push (lines ~233-247) with:
```ts
            needsCreateLoaderStubImport = true;
            const absServerPath = path.resolve(
              importerDir,
              serverImport.source.value
            );
            const loadersMeta = extractServerLoadersMeta(absServerPath);
            stubs.push(
              loaderStubSource(specifier.local.name, moduleKey, loadersMeta)
            );
```
and replace the inline `serverActions` stub push (lines ~261-269) with:
```ts
            needsUseActionImport = true;
            stubs.push(actionStubSource(specifier.local.name, moduleKey));
```
Delete the now-orphaned local `isServerImport` arrow (lines ~161-163) and the `DynamicServerImport[]` type alias (line ~83); `dynamicServerImports` keeps its annotation via the imported type:
```ts
      const dynamicServerImports: DynamicServerImport[] = [];
```

- [ ] **Step 5: Typecheck the vite package**

Run: `pnpm --filter '@hono-preact/vite' exec tsc --noEmit`
Expected: no errors (all moved symbols resolve through the new modules; no unused-import errors).

- [ ] **Step 6: Run the full vite suite, confirm no regression**

Run: `pnpm exec vitest run packages/vite/src/__tests__/`
Expected: PASS unchanged (server-only-plugin, server-only-server-loaders, build-bundle-leak, server-entry, guards-bundle, path-key-parity, hono-preact).

- [ ] **Step 7: Format + commit**

```bash
pnpm format
git add packages/vite/src/ast-walkers.ts packages/vite/src/source-extraction.ts packages/vite/src/stub-templates.ts packages/vite/src/server-only.ts
git commit -m "refactor(vite): split server-only into ast-walkers, source-extraction, stub-templates (#24)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rewrite `findDynamicServerImports` with `@babel/traverse` (#27)

**Files:**
- Modify: `packages/vite/package.json` (add `@babel/traverse` + its types)
- Modify: `packages/vite/src/ast-walkers.ts` (replace the hand-rolled walker)

`@babel/traverse` is **not** currently a dependency, so this task adds it. It replaces the denylist-based recursive walk with the canonical visitor. The existing dynamic-import tests in `server-only-plugin.test.ts` and `server-entry.test.ts` are the verification.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter '@hono-preact/vite' add @babel/traverse
pnpm --filter '@hono-preact/vite' add -D @babel/types
```
(`@babel/types` is already a dependency; the `-D` add is a no-op if present. `@babel/traverse`'s default export is CJS-interop, handled in Step 2.)

Verify `packages/vite/package.json` now lists `@babel/traverse` under `dependencies`.

- [ ] **Step 2: Replace `findDynamicServerImports` in `ast-walkers.ts`.** Swap the whole hand-rolled function for the traverse-based version. Keep the `DynamicServerImport` type and `isServerImport` unchanged. The function now takes the parsed `File`/`Program` node and uses the visitor:

```ts
import _traverse from '@babel/traverse';
import type { File, Node } from '@babel/types';

// @babel/traverse ships a CJS default export; under NodeNext ESM the callable
// lands on `.default`. Normalize once.
const traverse = (_traverse as unknown as { default: typeof _traverse })
  .default ?? _traverse;

export type DynamicServerImport = { start: number; end: number; source: string };

// Collect `import('...server...')` dynamic-import call sites. A dynamic import
// is an `import(...)` CallExpression whose callee is the `Import` node; we keep
// the ones whose first argument is a `.server[.jt]sx?` string literal so the
// transform can replace the body with a resolved stub.
export function findDynamicServerImports(
  ast: File | Node,
  found: DynamicServerImport[]
): void {
  traverse(ast as File, {
    CallExpression(path) {
      const { node } = path;
      if (node.callee.type !== 'Import') return;
      const arg = node.arguments[0];
      if (
        arg?.type === 'StringLiteral' &&
        /\.server(\.[jt]sx?)?$/.test(arg.value)
      ) {
        found.push({ start: node.start!, end: node.end!, source: arg.value });
      }
    },
  });
}
```

Note the input changes from "any node, recurse" to "the `File` AST, traverse once." `@babel/traverse` requires a `File` (or a node with scope) at the root.

- [ ] **Step 3: Update the call site in `server-only.ts`.** The current call passes `ast.program` (line ~168):
```ts
      findDynamicServerImports(ast.program, dynamicServerImports);
```
`@babel/traverse` needs the `File` node, not the bare `Program`. Change it to pass `ast` (the `parse(...)` result is a `File`):
```ts
      findDynamicServerImports(ast, dynamicServerImports);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter '@hono-preact/vite' exec tsc --noEmit`
Expected: no errors. If `_traverse`'s type is awkward under NodeNext, the `.default` normalization in Step 2 resolves the callable; do not add an `as any` at the call site.

- [ ] **Step 5: Run the dynamic-import tests**

Run: `pnpm exec vitest run packages/vite/src/__tests__/server-only-plugin.test.ts packages/vite/src/__tests__/server-entry.test.ts packages/vite/src/__tests__/build-bundle-leak.test.ts`
Expected: PASS (dynamic `import('...server...')` sites are still replaced with `Promise.resolve({ __moduleKey })`).

- [ ] **Step 6: Run the whole vite suite once more**

Run: `pnpm exec vitest run packages/vite/src/__tests__/`
Expected: PASS.

- [ ] **Step 7: Format + commit**

```bash
pnpm format
git add packages/vite/package.json packages/vite/src/ast-walkers.ts packages/vite/src/server-only.ts pnpm-lock.yaml
git commit -m "refactor(vite): replace hand-rolled dynamic-import walker with @babel/traverse (#27)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Reshape `fetchLoaderData` to `{ first, subscribe }` (#31)

**Files:**
- Modify: `packages/iso/src/internal/loader-fetch.ts`
- Modify: `packages/iso/src/internal/loader-stub.ts` (drop the no-op callbacks)
- Modify: `packages/iso/src/internal/loader-runner.ts` (subscribe + return `.first`)
- Test: `packages/iso/src/internal/__tests__/loader-fetch.test.ts`, `packages/iso/src/internal/__tests__/loader-fetch-timeout.test.ts`

Make the "I just want the value" vs "I want the stream" split explicit. `fetchLoaderData` becomes synchronous-returning (no longer `async`): it returns `{ first: Promise<T>, subscribe(callbacks): () => void }`. `first` does the fetch + error handling + first-chunk read; `subscribe` starts the background pump for subsequent SSE chunks (no-op for JSON responses). The pump starts only after `first` settles (so the SSE iterator is populated) and async iterators are pull-based, so a late `subscribe()` loses no chunks. `loader-stub.ts` stops constructing no-op callbacks.

- [ ] **Step 1: Update the existing `loader-fetch.test.ts` call sites** to the new shape (this is the failing-first step: the type changes, so these stop compiling/passing until the impl lands). Every `await fetchLoaderData(..., noopCbs)` becomes `await fetchLoaderData(...).first` and the `noopCbs` 5th argument is removed.

In `packages/iso/src/internal/__tests__/loader-fetch.test.ts`:
- Delete the `const noopCbs = ...` line (line 6).
- In "puts both module and loader into the request body" (line ~21): change
  ```ts
    await fetchLoaderData(
      'pages/movie',
      'summary',
      { path: '/movies/1', pathParams: { id: '1' }, searchParams: {} },
      new AbortController().signal,
      noopCbs
    );
  ```
  to
  ```ts
    await fetchLoaderData(
      'pages/movie',
      'summary',
      { path: '/movies/1', pathParams: { id: '1' }, searchParams: {} },
      new AbortController().signal
    ).first;
  ```
- In the redirect test (line ~53): change `const p = fetchLoaderData('m', 'default', loc, new AbortController().signal, noopCbs);` to `const p = fetchLoaderData('m', 'default', loc, new AbortController().signal).first;`
- In "returns the JSON value..." (line ~76): change `await fetchLoaderData('m','default',loc,signal,noopCbs)` to `await fetchLoaderData('m','default',loc,signal).first` (drop the `noopCbs` arg, append `.first`).
- In all three deny tests (lines ~98, ~120, ~138, ~156): change each
  ```ts
    await expect(
      fetchLoaderData('m','default',loc,new AbortController().signal,noopCbs)
    ).rejects.toThrow(...)
  ```
  to
  ```ts
    await expect(
      fetchLoaderData('m','default',loc,new AbortController().signal).first
    ).rejects.toThrow(...)
  ```

In `packages/iso/src/internal/__tests__/loader-fetch-timeout.test.ts`:
- Delete the `const noopCallbacks = ...` block (lines 8-12).
- In the two "throws TimeoutError" tests (lines ~32, ~61): change `await fetchLoaderData('m','l',location,controller.signal,noopCallbacks)` to `await fetchLoaderData('m','l',location,controller.signal).first`.
- In "reports TimeoutError via onError when timeout fires mid-stream" (line ~91): change
  ```ts
    const first = await fetchLoaderData(
      'm','l',location,controller.signal,callbacks
    );
  ```
  to
  ```ts
    const handle = fetchLoaderData('m', 'l', location, controller.signal);
    handle.subscribe(callbacks);
    const first = await handle.first;
  ```

- [ ] **Step 2: Run the tests to confirm they fail** (against the un-reshaped impl)

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-fetch.test.ts packages/iso/src/internal/__tests__/loader-fetch-timeout.test.ts`
Expected: FAIL/type-error (`.first` does not exist on the current `Promise<T>` return; `subscribe` undefined).

- [ ] **Step 3: Reshape `fetchLoaderData` in `loader-fetch.ts`.** Replace the `export async function fetchLoaderData<T>(...)` signature and body (lines ~25-168) with the synchronous-returning version below. `readFirstChunk` (lines ~175-224) is unchanged. Export a new `LoaderFetchHandle<T>` type; keep `LoaderFetchCallbacks<T>`.

```ts
export type LoaderFetchHandle<T> = {
  /**
   * Resolves with the first (or only) loader value. Rejects on an error or
   * timeout that occurs before the first chunk. For a redirect outcome the
   * promise never settles (the page is navigating away).
   */
  first: Promise<T>;
  /**
   * Attach callbacks for a streaming loader: onChunk fires for each chunk
   * after the first, onError for a mid-stream error/timeout, onEnd at stream
   * end. No-op for non-streaming (JSON) responses. Returns an unsubscribe that
   * stops the background pump. Call at most once.
   */
  subscribe(callbacks: LoaderFetchCallbacks<T>): () => void;
};

/**
 * POST to /__loaders and consume the response.
 *
 * Static loaders return JSON; `handle.first` resolves with the parsed value.
 * Streaming loaders return SSE; `handle.first` resolves with the first chunk
 * and `handle.subscribe(callbacks)` drives the rest (onChunk per later chunk,
 * onError mid-stream, onEnd at end). The pump starts only after `first`
 * settles, so subscribing synchronously after the call loses no chunks.
 */
export function fetchLoaderData<T>(
  moduleKey: string,
  loaderName: string,
  location: SerializedLocation,
  signal: AbortSignal
): LoaderFetchHandle<T> {
  // Populated only when the response is SSE and its first chunk has been read.
  // `subscribe` pumps off this iterator; null means a non-streaming response
  // (nothing to pump).
  let streamIter: AsyncGenerator<{ event: string; data: string }> | null = null;

  const first = (async (): Promise<T> => {
    const res = await fetch(LOADERS_RPC_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: moduleKey, loader: loaderName, location }),
      signal,
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        __outcome?: string;
        message?: string;
        timeoutMs?: number;
      };
      if (body.__outcome === 'timeout' && typeof body.timeoutMs === 'number') {
        throw new TimeoutError(body.timeoutMs);
      }
      if (body.__outcome === 'deny') {
        const msg =
          typeof body.message === 'string'
            ? body.message
            : `Request denied (${res.status})`;
        throw new Error(msg);
      }
      throw new Error(
        body.error ??
          `Loader failed with status ${res.status}. Check the loader's .server.ts for a thrown error, and the server logs for details.`
      );
    }

    const contentType = res.headers.get('Content-Type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      const json = (await res.json()) as unknown;
      // A loader that legitimately returns `{ __outcome: 'redirect', to }` is
      // misinterpreted here (documented v0.1 contract; see C6/C4 in the
      // middleware review). `to` is taken from the body and passed to
      // location.assign; treat your own server as trusted.
      if (
        json !== null &&
        typeof json === 'object' &&
        (json as { __outcome?: unknown }).__outcome === 'redirect' &&
        typeof (json as { to?: unknown }).to === 'string'
      ) {
        const to = (json as { to: string }).to;
        if (typeof window !== 'undefined') {
          window.location.assign(to);
        }
        return new Promise<T>(() => {
          /* never resolves; page is navigating */
        });
      }
      return json as T;
    }

    if (!res.body) {
      throw new Error('Streaming loader response has no body');
    }

    // SSE: read the first message event (await first chunk). Hand the iterator
    // to `subscribe` so later chunks pump on demand.
    const iter = readSSE(res.body);
    const firstChunk = await readFirstChunk<T>(iter);
    streamIter = iter;
    return firstChunk;
  })();

  function subscribe(callbacks: LoaderFetchCallbacks<T>): () => void {
    let stopped = false;
    // Start the pump only after `first` settles: a non-streaming response or a
    // pre-first-chunk rejection leaves `streamIter` null (nothing to pump).
    first.then(
      () => {
        if (stopped || streamIter === null) return;
        const iter = streamIter;
        void (async () => {
          try {
            while (true) {
              if (stopped) return;
              const step = await iter.next();
              if (step.done) {
                callbacks.onEnd();
                return;
              }
              const ev = step.value;
              if (ev.event === 'message') {
                try {
                  callbacks.onChunk(JSON.parse(ev.data) as T);
                } catch {
                  // malformed mid-stream chunk: skip
                }
              } else if (ev.event === 'timeout') {
                try {
                  const parsed = JSON.parse(ev.data) as { timeoutMs?: number };
                  callbacks.onError(new TimeoutError(parsed.timeoutMs ?? 0));
                } catch {
                  callbacks.onError(
                    new Error('Malformed timeout event in streaming loader')
                  );
                }
                return;
              } else if (ev.event === 'error') {
                try {
                  const parsed = JSON.parse(ev.data) as {
                    message?: string;
                    name?: string;
                  };
                  const err = new Error(parsed.message ?? 'Streamed error');
                  if (parsed.name) err.name = parsed.name;
                  callbacks.onError(err);
                } catch {
                  callbacks.onError(new Error('Streamed error'));
                }
                return;
              }
              // Ignore other event types
            }
          } catch (err) {
            if (signal.aborted) return;
            callbacks.onError(
              err instanceof Error ? err : new Error(String(err))
            );
          }
        })();
      },
      () => {
        /* first rejected before any chunk: no stream to pump */
      }
    );
    return () => {
      stopped = true;
    };
  }

  return { first, subscribe };
}
```

- [ ] **Step 4: Update `loader-stub.ts`** to drop the no-op callbacks. Replace the `fn` body (lines ~17-34) so it awaits `.first`:

```ts
  const fn = async ({
    location,
    signal,
  }: {
    location: any;
    signal?: AbortSignal;
  }) =>
    fetchLoaderData<T>(
      opts.__moduleKey,
      opts.__loaderName,
      {
        path: location.path,
        pathParams: location.pathParams,
        searchParams: location.searchParams,
      },
      signal ?? new AbortController().signal
    ).first;
```
Update the comment above it (lines ~13-16): the callbacks are gone, so reword to "this fn is the SSR / direct-fn fallback path only; it awaits the first value and ignores any streamed chunks."

- [ ] **Step 5: Update `loader-runner.ts`** client-fetch path (lines ~62-74) to subscribe then return `.first`:

```ts
  if (useFetchPath) {
    const handle = fetchLoaderData<T>(
      loaderRef.__moduleKey!,
      loaderName,
      {
        path: location.path,
        pathParams: (location.pathParams ?? {}) as Record<string, string>,
        searchParams: (location.searchParams ?? {}) as Record<string, string>,
      },
      signal
    );
    // Stream subsequent chunks to the caller's callbacks. Teardown is driven by
    // the request `signal` (abort stops the pump), so the unsubscribe handle is
    // not retained here.
    handle.subscribe(callbacks);
    return handle.first;
  }
```

- [ ] **Step 6: Typecheck iso**

Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the loader-fetch + consumer tests**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-fetch.test.ts packages/iso/src/internal/__tests__/loader-fetch-timeout.test.ts packages/iso/src/internal/__tests__/loader-stub.test.ts packages/iso/src/__tests__/loader-runner-c.test.tsx packages/iso/src/__tests__/loader-middleware.test.tsx`
Expected: PASS (value path identical; the mid-stream onError test drives via `subscribe`).

- [ ] **Step 8: Format + commit**

```bash
pnpm format
git add packages/iso/src/internal/loader-fetch.ts packages/iso/src/internal/loader-stub.ts packages/iso/src/internal/loader-runner.ts packages/iso/src/internal/__tests__/loader-fetch.test.ts packages/iso/src/internal/__tests__/loader-fetch-timeout.test.ts
git commit -m "refactor(iso): reshape fetchLoaderData to { first, subscribe } (#31)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Wrap-up: full CI mirror + close #28

- [ ] **Step 1: Build the framework dist** (typecheck/site resolve cross-package types through it)

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
```

- [ ] **Step 2: Run the six pre-push checks in CI order**

```bash
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all green. If `format:check` fails, run `pnpm format`, then `git commit -m "chore: format"` with the co-author trailer.

- [ ] **Step 3: Close the already-resolved issue #28**

```bash
gh issue close 28 --comment "Already implemented: packages/server/src/route-server-modules.ts returns manifest.serverImports directly (the stringified-int-key record was removed). Closed as part of the modularity sweep (#24/#25/#26/#27/#29/#31)."
```

- [ ] **Step 4: Push and open the PR** (only after the user confirms; see Execution Handoff)

```bash
git push -u origin refactor/modularity-sweep
gh pr create --fill --title "refactor: framework modularity sweep (#24 #25 #26 #27 #29 #31)"
```

---

## Self-Review (completed during authoring)

- **Coverage:** #24 (Task 4) · #25 (Task 1) · #26 (Task 2) · #27 (Task 5) · #29 (Task 3) · #31 (Task 6) · #28 (wrap-up close). All seven backlog items mapped to a task. #30 already closed (noted, no task).
- **Placeholders:** none — every code/test step shows the exact content.
- **Type consistency:** `joinRoutePath(parentPath, childPath)` signature is used identically in Tasks 1's three call sites. `LoaderFetchHandle<T>` `{ first, subscribe }` is produced in Task 6 Step 3 and consumed with the same property names in Steps 4 (`.first`), 5 (`.subscribe` + `.first`), and the test updates in Step 1. `ViewRenderer` keeps its exact prop shape across the move (Task 3). `findDynamicServerImports` input changes from `Program` to `File` in both the definition (Task 5 Step 2) and the call site (Task 5 Step 3).
- **Ordering:** Task 4 moves `findDynamicServerImports` into `ast-walkers.ts` as-is; Task 5 rewrites it there. Tasks 1 and 2 both touch `define-routes.tsx` but different functions; doing 1 before 2 means `validate`'s independent join is untouched by the helper.
