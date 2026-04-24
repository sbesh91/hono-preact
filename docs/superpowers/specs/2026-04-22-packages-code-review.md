# Code Review: `packages/` Directory

**Date:** 2026-04-22
**Reviewer:** superpowers:code-reviewer (automated)
**Scope:** All source files in `packages/hono-preact`, `packages/iso`, `packages/server`, `packages/vite`
**Git range:** `8edd46f` → `e37d1c2`

---

## Triage Key

| Severity | Meaning |
|---|---|
| 🔴 Critical | Bugs, security holes, data loss — must fix |
| 🟡 Important | Type holes, missing critical test coverage, API problems — fix before shipping |
| 🟢 Minor | Style, unnecessary complexity, small improvements |

---

## 🔴 Critical Issues

### C1 — XSS: title and `lang` not HTML-escaped in `render.tsx`

**File:** `packages/server/src/render.tsx:35,42`
**Status:** [ ] Open

`title` and `lang` are interpolated directly into raw string templates:

```typescript
`<title>${title ?? options?.defaultTitle ?? ''}</title>`
<html lang="${lang ?? 'en-US'}">
```

If `useTitle()` is called with user-controlled data (e.g. set from a URL param or DB record), a value like `</title><script>alert(1)</script><title>` executes in the browser. Similarly, `lang` can break out of its attribute context with `en" onload="alert(1)`.

The `toAttrs()` helper already escapes `"` with `&quot;` for `metas`/`links`, but it is not applied to either of these injection points.

**Fix:** Add an HTML content/attribute escaper and apply it to `title` (content escape) and `lang` (attribute escape).

---

### C2 — Hydration silently breaks for empty-object/array loader results

**File:** `packages/iso/src/page.tsx:152`
**Status:** [ ] Open

```typescript
const isLoaded = Object.keys(preloaded).length > 0;
```

`getPreloadedData` returns `{} as T` as the sentinel "no data" value. This check distinguishes "real data was preloaded" from "nothing preloaded" by key count, which breaks for:

- `serverLoader` returning `{}` — `isLoaded` is `false`, client fires a redundant `clientLoader` call on every page load, ignoring SSR data
- `serverLoader` returning `[]` — same
- `serverLoader` returning `0`, `""`, or `false` — `Object.keys()` returns 0 for primitives

**Fix:** Use a separate `data-loader-initialized` attribute or flag rather than relying on key count as a sentinel.

---

### C3 — `serverOnlyPlugin` only stubs the first `.server` import per file

**File:** `packages/vite/src/server-only.ts:33`
**Status:** [ ] Open

```typescript
const serverImport = ast.program.body.find(isServerImport);
```

`.find()` returns only the first match. A file importing from two `.server` modules (e.g. `import serverLoader from './movies.server.js'` and `import authLoader from './auth.server.js'`) will have only the first import stubbed. The second `.server` module's code and its transitive imports reach the client bundle — a server/client boundary violation that can leak server-only secrets.

**Fix:** Change `.find()` to `.filter()` and iterate over all matched imports, overwriting each using `MagicString` in reverse offset order.

---

## 🟡 Important Issues

### I1 — Guards are stale after client-side navigation

**File:** `packages/iso/src/page.tsx:70`
**Status:** [ ] Open

```typescript
const guardRef = useRef(wrapPromise(runGuards(guards, { location })));
```

`useRef` only initializes once. The initial `location` is captured at mount and `guardRef.current` is never updated on navigation. Guards do not re-run when the user navigates to a new route — a route guard checking `location.path` (e.g. to restrict `/admin`) will not fire on client-side navigation.

**Fix:** Reset `guardRef.current` when the path changes, using the `prevPath` pattern already present in `GuardedPage`.

---

### I2 — `reload()` silently discards errors

**File:** `packages/iso/src/page.tsx:130–132`
**Status:** [ ] Open

```typescript
.catch(() => {
  setReloading(false);
});
```

When `clientLoader` throws during a reload (network failure, auth error), the error is silently dropped. `reloading` returns to `false` and the component shows stale data with no indication of failure. `ReloadContextValue` has no `error` field.

**Fix:** Add `error: Error | null` to `ReloadContextValue` and expose it via context.

---

### I3 — `env.current` defaults to `"browser"` with no auto-reset in `renderPage`

**File:** `packages/iso/src/is-browser.tsx:2`
**Status:** [ ] Open

```typescript
export let env: { current: "browser" | "server" } = { current: "browser" };
```

`renderPage` never sets `env.current = 'server'`. This is left entirely to the app entry point. If a consumer forgets this call, `isBrowser()` returns `true` during SSR, causing guards to skip (taking the client path), and the `Helper` component to embed `'{}'` instead of real data — silently breaking all SSR data embedding.

**Fix:** Have `renderPage` set `env.current = 'server'` before calling `prerender()` and restore it after, or document this as a required setup step with a runtime warning.

---

### I4 — `wrapPromise` type hole in the error path

**File:** `packages/iso/src/wrap-promise.ts:10–12`
**Status:** [ ] Open

`response` is typed as `T` but stores the rejection value (`unknown`) in the error case. TypeScript accepts this because the `.then()` error handler is typed as `(err: any) => void`. When `read()` throws `response` in the error case, the throw site has type `T` but the runtime value is the actual rejection reason.

**Fix:**

```typescript
let result: T;
let error: unknown;
// success: result = res;  error: error = err;
// read() error case: throw error;
```

---

### I5 — Barrel package re-exports Vite plugins alongside isomorphic/server code

**File:** `packages/hono-preact/src/index.ts`
**Status:** [ ] Open

```typescript
export * from '@hono-preact/iso';
export * from '@hono-preact/server';
export * from '@hono-preact/vite';
```

Vite plugins pull in Node.js-only dependencies (`@babel/parser`, `@babel/types`, `magic-string`, `vite`). Bundling them into the root barrel alongside browser-targeting `@hono-preact/iso` code risks pulling Node-only deps into edge/browser builds on any tree-shaking failure.

**Fix:** Move Vite plugin exports to a separate entry point (e.g. `hono-preact/vite`) via `package.json` `exports` field.

---

### I6 — `isLoaded` edge cases untested

**File:** `packages/iso/src/__tests__/loader.test.tsx`
**Status:** [ ] Open

Preloaded-data hydration is tested only with `{ msg: 'preloaded' }`. Missing tests:
- `serverLoader` returning `{}`
- `serverLoader` returning an array
- `deletePreloadedData` call timing (data deleted in `finally`; re-render before first render would find no data)

---

### I7 — `render.tsx` tests missing coverage for injection paths

**File:** `packages/server/src/__tests__/render.test.tsx`
**Status:** [ ] Open

No tests for:
- `useMeta()` output in `<meta>` tags
- `useLink()` output in `<link>` tags
- `lang` attribute rendering
- Missing `</head>` in rendered fragment (silent broken HTML)
- Multiple `</head>` occurrences (e.g. inside a `<script>` string literal)

---

## 🟢 Minor Issues

### M1 — `LoaderData<T>.loaderData` typed optional but always provided

**File:** `packages/iso/src/loader.tsx:8–12`

`loaderData?: T` forces defensive `?.` checks at every consumer call site despite always being set by `Helper`. Typing it as `loaderData: T` would shift type errors to the right place.

---

### M2 — `T extends {}` constraint too broad

**Files:** `packages/iso/src/page.tsx:57,101`, `packages/iso/src/loader.tsx:26`

`T extends {}` allows strings, numbers, booleans, and arrays — inconsistent with the `Object.keys()` `isLoaded` check (see C2). `T extends Record<string, unknown>` is more precise and eliminates several of the C2 edge cases.

---

### M3 — `data-page` boolean attribute set but never queried

**File:** `packages/iso/src/page.tsx:37,226`

Attribute is set as `data-page={true}` but no code queries `[data-page]`. Either document as a consumer selector hook or remove.

---

### M4 — `serverLoaderValidationPlugin` doesn't handle `export * from '...'`

**File:** `packages/vite/src/server-loader-validation.ts`

`ExportAllDeclaration` is not checked. A `.server` file using `export * from './other'` bypasses the validator.

---

### M5 — Two sequential `this.error()` calls in validation plugin

**File:** `packages/vite/src/server-loader-validation.ts:50–61`

`this.error()` throws, so the second check is unreachable when the first fires. Compose both checks before calling `this.error()` once with a combined message.

---

### M6 — `preload.ts` has no direct unit tests

No tests for:
- `finally` block deletion behavior
- Malformed JSON in `el.dataset.loader` (returns `{}` silently)
- Missing DOM element for given `id`

---

### M7 — `reload()` callback recreated on `location` reference changes

**File:** `packages/iso/src/page.tsx:133`

`location` is a `RouteHook` prop in the `useCallback` dependency array. If the parent re-renders with a new reference (same path, new object), the callback is recreated unnecessarily. Use a ref for stable identity.

---

## Strengths

- **Clean package split** — iso/server/vite boundary is well-reasoned; isomorphic, SSR, and build concerns stay separated
- **Guard system** — `GuardFn` chain-of-responsibility + `GuardRedirect` throw-and-catch at `renderPage` is elegant
- **Vite plugins use Babel AST** — robust, not regex-based parsing
- **`wrapPromise` Suspense contract** — correctly implements all three Suspense states; fully tested
- **`toAttrs()` attribute escaping** — `"` → `&quot;` present and correct for meta/link attributes
- **Test quality** — behavior-focused, not implementation-focused; good isolation patterns in mocks
