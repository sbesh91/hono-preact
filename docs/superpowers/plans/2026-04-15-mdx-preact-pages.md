# MDX Preact Pages Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable static content pages authored as `.mdx` files in `src/pages/docs/` to be automatically discovered and served as preact-iso routes under `/docs/*`.

**Architecture:** Install `@mdx-js/rollup`, wire it into both Vite build configs before the JSX transform, declare `.mdx` module types for TypeScript, and update `iso.tsx` to glob-import all `src/pages/docs/*.mdx` files and register them as routes with an auto-prepended `/docs` prefix.

**Tech Stack:** `@mdx-js/rollup`, Vite, preact-iso, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `package.json` | Add `@mdx-js/rollup` to `devDependencies` |
| `package-lock.json` | Updated by `npm install` |
| `vite.config.ts` | Import and add MDX plugin to both client and server plugin arrays |
| `src/mdx.d.ts` | **Create** — TypeScript ambient declaration for `*.mdx` modules |
| `tsconfig.json` | Add `"./src/**/*.mdx"` to `include` |
| `src/iso.tsx` | Add `import.meta.glob` for `./pages/docs/*.mdx` and render discovered routes |
| `src/pages/docs/hello.mdx` | **Create** — sample page to verify the pipeline end-to-end |

---

### Task 1: Install `@mdx-js/rollup`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the package**

```bash
npm install --save-dev @mdx-js/rollup
```

Expected: `package.json` `devDependencies` gains `"@mdx-js/rollup": "^..."` and `package-lock.json` is updated. No errors.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @mdx-js/rollup devDependency"
```

---

### Task 2: Add TypeScript declaration for `.mdx` modules

**Files:**
- Create: `src/mdx.d.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Create `src/mdx.d.ts`**

```ts
declare module '*.mdx' {
  import type { ComponentType } from 'preact';
  const MDXContent: ComponentType;
  export default MDXContent;
}
```

- [ ] **Step 2: Add `.mdx` to `tsconfig.json` include**

In `tsconfig.json`, change:
```json
"include": ["./src/**/*.tsx", "./src/**/*.ts", "./src/**/*.json"]
```
to:
```json
"include": ["./src/**/*.tsx", "./src/**/*.ts", "./src/**/*.json", "./src/**/*.mdx"]
```

- [ ] **Step 3: Verify TypeScript is satisfied**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/mdx.d.ts tsconfig.json
git commit -m "feat: add TypeScript declaration for .mdx modules"
```

---

### Task 3: Configure Vite with the MDX plugin

**Files:**
- Modify: `vite.config.ts`

The MDX plugin must run before the Preact JSX transform. In the client config it goes before `preact()`; in the server config it goes first (no `preact()` is present there). `enforce: 'pre'` is added via `Object.assign` — `@mdx-js/rollup` doesn't accept it as a plugin option directly.

- [ ] **Step 1: Add the import**

At the top of `vite.config.ts`, add:
```ts
import mdx from '@mdx-js/rollup';
```

- [ ] **Step 2: Add to client config plugins**

In the `if (env.mode === 'client' || env.mode === 'visualizer')` block, update `plugins`:
```ts
plugins: [
  Object.assign(mdx({ jsxImportSource: 'preact' }), { enforce: 'pre' }),
  preact(),
  serverOnlyPlugin(true),
  ...
]
```

- [ ] **Step 3: Add to server config plugins**

In the server `return` block, update `plugins`:
```ts
plugins: [
  Object.assign(mdx({ jsxImportSource: 'preact' }), { enforce: 'pre' }),
  serverLoaderValidationPlugin(),
  build({ entry: 'src/server.tsx' }),
  devServer({ ... }),
]
```

- [ ] **Step 4: Verify the build succeeds**

```bash
npm run build
```

Expected: build completes without errors. (No MDX pages exist yet so the glob will resolve to an empty object — that's fine.)

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts
git commit -m "feat: add @mdx-js/rollup plugin to Vite client and server configs"
```

---

### Task 4: Auto-discover MDX routes in `iso.tsx`

**Files:**
- Modify: `src/iso.tsx`

- [ ] **Step 1: Update `iso.tsx`**

Replace the contents of `src/iso.tsx` with:

```tsx
import type { ComponentType, FunctionComponent } from 'preact';
import { flushSync } from 'preact/compat';
import { lazy, Route, Router } from 'preact-iso';
import NotFound from './pages/not-found.js';

const Home = lazy(() => import('./pages/home.js'));
const Test = lazy(() => import('./pages/test.js'));
const Movies = lazy(() => import('./pages/movies.js'));

// Each MDX file is lazy-loaded (code-split), consistent with the page pattern
// above. Route paths are derived from filenames at module-evaluation time —
// the glob keys are statically analysable by Rollup so no dynamic import of
// module contents is needed to know the path.
const mdxModules = import.meta.glob('./pages/docs/*.mdx');
const mdxRoutes = Object.entries(mdxModules).map(([filePath, load]) => ({
  route: '/docs' + filePath.replace('./pages/docs', '').replace('.mdx', ''),
  Component: lazy(load as () => Promise<{ default: ComponentType }>),
}));

function onRouteChange() {
  if (!document.startViewTransition) return;
  document.startViewTransition(() => flushSync(() => {}));
}

export const Base: FunctionComponent = () => {
  return (
    <Router onRouteChange={onRouteChange}>
      <Route path="/" component={Home} />
      <Route path="/test" component={Test} />
      <Route path="/movies" component={Movies} />
      <Route path="/movies/*" component={Movies} />
      {mdxRoutes.map(({ route, Component }) => (
        <Route path={route} component={Component} />
      ))}
      <NotFound />
    </Router>
  );
};
```

- [ ] **Step 2: Verify TypeScript is satisfied**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/iso.tsx
git commit -m "feat: auto-discover MDX pages from src/pages/docs/ as /docs/* routes"
```

---

### Task 5: Add a sample MDX page and verify end-to-end

**Files:**
- Create: `src/pages/docs/hello.mdx`

- [ ] **Step 1: Create the docs directory and sample page**

Create `src/pages/docs/hello.mdx`:

```mdx
# Hello from MDX

This page is served at `/docs/hello` and rendered by Preact.
```

- [ ] **Step 2: Run the dev server and verify the route**

```bash
npm run dev
```

Open `http://localhost:5173/docs/hello` in a browser.

Expected: page renders with the heading "Hello from MDX" and the paragraph text. No console errors.

- [ ] **Step 3: Verify the production build includes the page**

```bash
npm run build
```

Expected: build succeeds. The client bundle should include a chunk for the MDX page.

- [ ] **Step 4: Commit**

```bash
git add src/pages/docs/hello.mdx
git commit -m "feat: add sample MDX doc page at /docs/hello"
```

---

### Task 6: Push

- [ ] **Step 1: Push all commits**

```bash
git push
```
