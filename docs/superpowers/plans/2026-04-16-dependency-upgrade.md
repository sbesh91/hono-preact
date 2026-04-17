# Dependency Upgrade (Full Bump) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade all outdated dependencies to their latest versions, including Vite 7 → 8 and TypeScript 5 → 6, with a verified working build.

**Architecture:** Update version ranges in `package.json`, reinstall, fix any TypeScript 6 type errors, and verify both the production build and dev server still work.

**Tech Stack:** Node.js, npm, Vite 8, TypeScript 6, Hono, Preact, Cloudflare Workers (wrangler)

---

## Files

- Modify: `package.json` — version range updates for all outdated packages

---

### Task 1: Update `package.json` versions

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update all version ranges**

Edit `package.json` to the following values (replace only the version strings shown):

**`dependencies`:**
```json
"dotenv": "^17.4.2",
"hono": "^4.12.14",
"preact": "^10.29.1",
```

**`devDependencies`:**
```json
"@babel/parser": "^7.29.2",
"@hono/node-server": "^1.19.14",
"@hono/vite-build": "^1.11.1",
"@hono/vite-dev-server": "^0.25.1",
"@preact/preset-vite": "^2.10.5",
"@tailwindcss/postcss": "^4.2.2",
"@types/node": "^25.6.0",
"miniflare": "^4.20260415.0",
"postcss": "^8.5.10",
"preact-render-to-string": "^6.6.7",
"prettier": "^3.8.3",
"rollup-plugin-visualizer": "^7.0.1",
"sass-embedded": "^1.99.0",
"tailwindcss": "^4.2.2",
"typescript": "^6.0.3",
"vite": "^8.0.8",
"wrangler": "^4.83.0",
```

Leave all other fields (`name`, `type`, `scripts`, packages not listed above) unchanged.

- [ ] **Step 2: Install updated packages**

```bash
npm install
```

Expected: No fatal errors. Peer dependency warnings are acceptable as long as none are for `vite`, `typescript`, or the Hono/Preact plugins.

- [ ] **Step 3: Commit the package changes**

```bash
git add package.json package-lock.json
git commit -m "chore: bump all dependencies to latest (vite 8, typescript 6)"
```

---

### Task 2: Fix TypeScript 6 type errors

**Files:**
- Modify: any `.ts` / `.tsx` files that produce type errors

- [ ] **Step 1: Run the type checker**

```bash
npx tsc --noEmit
```

Expected: Zero errors. If errors appear, proceed to the next step. If none, skip to Task 3.

- [ ] **Step 2: Fix each reported type error**

Address errors one at a time. Common TypeScript 6 breaking changes to watch for:
- Stricter `noImplicitAny` inference
- Removed or renamed utility types
- Stricter narrowing in conditional branches
- Changes to `lib` defaults

Fix each error with the minimal change required — do not refactor surrounding code.

- [ ] **Step 3: Re-run type checker to confirm clean**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 4: Commit fixes (if any files were changed)**

```bash
git add -p
git commit -m "fix: resolve TypeScript 6 type errors"
```

Skip this step if no files were modified.

---

### Task 3: Verify production build

**Files:** none (read-only verification)

- [ ] **Step 1: Run the full build**

```bash
npm run build
```

This runs both the client build and the Cloudflare Workers SSR build. Expected: exits with code 0, produces files in `dist/`.

- [ ] **Step 2: If build fails, diagnose and fix**

Read the error output carefully. Likely causes:
- A Vite 8 config API change (check `vite.config.ts` against https://vite.dev/guide/migration)
- A plugin incompatibility (check the plugin emitting the error)

Apply the minimal fix, then re-run `npm run build` until it passes.

- [ ] **Step 3: Commit any build fixes**

```bash
git add -p
git commit -m "fix: update config for Vite 8 compatibility"
```

Skip if no files were changed.

---

### Task 4: Verify dev server

**Files:** none (read-only verification)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: Server starts without crashing. You should see a local URL printed (typically `http://localhost:5173`).

- [ ] **Step 2: Open the app in a browser**

Navigate to the local URL. Verify:
- The page loads without a blank screen or JS errors in the console
- No 500 errors from the Hono dev server

- [ ] **Step 3: Stop the dev server**

Press `Ctrl+C`.

- [ ] **Step 4: Commit any dev server fixes**

```bash
git add -p
git commit -m "fix: resolve dev server issue after Vite 8 upgrade"
```

Skip if no changes were needed.

---

## Rollback

If any task cannot be resolved, restore the original state:

```bash
git checkout package.json package-lock.json
npm install
```
