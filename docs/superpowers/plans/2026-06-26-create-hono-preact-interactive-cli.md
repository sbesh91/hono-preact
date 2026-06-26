# Interactive `create-hono-preact` CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `create-hono-preact` as an interactive `@clack/prompts` wizard (modeled on create-preact) with flags retained as a scripted/CI path, and move the templates to a base + adapter/UI overlays model.

**Architecture:** A thin clack shell at the edge over a pure, injectable core. `parseArgs` turns argv into partial intent; `resolveOptions` fills the gaps (prompting in interactive mode, defaulting otherwise); `scaffold` composes a project from `templates/base` plus the chosen `adapter/*` and `feature/ui` overlays, deep-merging `package.json` fragments. `cli.run()` orchestrates parse -> resolve -> scaffold -> install -> git. Non-interactive mode (CI, `--yes`, no TTY) reproduces today's plain output exactly; clack UI appears only in interactive mode.

**Tech Stack:** Node ESM (no build step), `@clack/prompts` (new), `picocolors` (existing), `node:child_process` `spawn` (existing), vitest.

## Global Constraints

- TypeScript-only templates. No JavaScript variant, no language prompt.
- The only new runtime dependency is `@clack/prompts`. Keep `picocolors` (not kolorist) and `node:child_process` `spawn` (not tinyexec).
- Template `package.json` fragments stay version-pinned. Carry these exact pins:
  - base deps: `hono ^4.12.14`, `hono-preact ^0.8.0`, `preact ^10.29.1`, `preact-iso github:preactjs/preact-iso#v3`.
  - base devDeps: `@preact/preset-vite ^2.10.5`, `preact-render-to-string ^6.6.7`, `typescript ^5.6.0`, `vite ^8.0.8`.
  - cloudflare devDeps: `@cloudflare/vite-plugin ^1.37.1`, `wrangler ^4.92.0`.
  - node devDeps: `@hono/node-server ^1.19.14`, `@hono/node-ws ^1.3.1`.
  - ui deps: `hono-preact-ui ^0.2.0`.
- `lib/*.mjs` are hand-authored ES modules with hand-authored `lib/*.d.mts` declarations (the package has `noEmit: true`; `lib/` is not compiled). Update the matching `.d.mts` whenever a module's exports change.
- `create-hono-preact` is a standalone CLI package (`bin` only, no `exports`), not part of the `@hono-preact/*` umbrella; no umbrella/`--filter` wiring is needed for its deps.
- No em-dashes in prose or comments (repo writing rule).
- Defaults when a value is not supplied: adapter `cloudflare`, ui off, install on, git on.
- Pre-push gate: all eight CI steps from `CLAUDE.md` must pass before pushing.
- Work happens in the `worktree-create-cli-interactive` worktree (already created off `main`). Run `pnpm wt:setup` once before starting, and `pnpm gen:agents-corpus` before any test that touches `add-agents`/scaffold (the bundled corpus is gitignored).

---

## Task 1: `package.json` deep-merge utilities + `@clack/prompts` dependency

**Files:**
- Modify: `packages/create-hono-preact/package.json` (add `@clack/prompts`)
- Modify: `packages/create-hono-preact/lib/template.mjs` (add `deepMerge`, `composePackageJson`)
- Modify: `packages/create-hono-preact/lib/template.d.mts`
- Test: `packages/create-hono-preact/__tests__/merge.test.ts` (new)

**Interfaces:**
- Produces:
  - `deepMerge(a: object, b: object): object` — nested objects merge recursively; arrays and scalars from `b` replace those in `a`; neither input mutated.
  - `composePackageJson(fragmentPaths: string[]): Promise<object>` — read and deep-merge an ordered list of `package.json` fragment files (earlier = base, later = overlay).

- [ ] **Step 1: Add the dependency**

Run from the repo root:
```bash
pnpm --filter create-hono-preact add @clack/prompts
```
Expected: `package.json` gains `"@clack/prompts"` under `dependencies`; lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `packages/create-hono-preact/__tests__/merge.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepMerge, composePackageJson } from '../lib/template.mjs';

describe('deepMerge', () => {
  it('merges nested objects', () => {
    expect(
      deepMerge(
        { scripts: { dev: 'vite' }, dependencies: { preact: '^10' } },
        { scripts: { build: 'vite build' }, dependencies: { hono: '^4' } }
      )
    ).toEqual({
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { preact: '^10', hono: '^4' },
    });
  });

  it('replaces scalars and arrays from b', () => {
    expect(deepMerge({ a: 1, list: [1, 2] }, { a: 2, list: [3] })).toEqual({
      a: 2,
      list: [3],
    });
  });

  it('does not mutate either input', () => {
    const a = { scripts: { dev: 'vite' } };
    const b = { scripts: { build: 'x' } };
    deepMerge(a, b);
    expect(a).toEqual({ scripts: { dev: 'vite' } });
    expect(b).toEqual({ scripts: { build: 'x' } });
  });
});

describe('composePackageJson', () => {
  it('merges fragment files in order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chp-merge-'));
    try {
      writeFileSync(
        join(dir, 'base.json'),
        JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { preact: '^10' } })
      );
      writeFileSync(
        join(dir, 'overlay.json'),
        JSON.stringify({ scripts: { deploy: 'wrangler deploy' }, devDependencies: { wrangler: '^4' } })
      );
      const merged = await composePackageJson([
        join(dir, 'base.json'),
        join(dir, 'overlay.json'),
      ]);
      expect(merged).toEqual({
        scripts: { dev: 'vite', deploy: 'wrangler deploy' },
        dependencies: { preact: '^10' },
        devDependencies: { wrangler: '^4' },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/merge.test.ts`
Expected: FAIL with `deepMerge is not a function` / `composePackageJson is not a function`.

- [ ] **Step 4: Implement in `lib/template.mjs`**

Add `basename` to the `node:path` import (it becomes `import { join, dirname, basename } from 'node:path';`), then append:
```js
/**
 * True for a non-null, non-array object.
 *
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge two plain objects. Nested objects merge recursively; arrays and
 * scalars from `b` replace those in `a`. Neither input is mutated.
 *
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @returns {Record<string, unknown>}
 */
export function deepMerge(a, b) {
  /** @type {Record<string, unknown>} */
  const out = { ...a };
  for (const [key, bv] of Object.entries(b)) {
    const av = out[key];
    out[key] = isPlainObject(av) && isPlainObject(bv) ? deepMerge(av, bv) : bv;
  }
  return out;
}

/**
 * Read and deep-merge an ordered list of package.json fragment files into one
 * object. Earlier paths are the base; later paths overlay.
 *
 * @param {string[]} fragmentPaths absolute paths to package.json fragments
 * @returns {Promise<Record<string, unknown>>}
 */
export async function composePackageJson(fragmentPaths) {
  /** @type {Record<string, unknown>} */
  let merged = {};
  for (const path of fragmentPaths) {
    const fragment = JSON.parse(await readFile(path, 'utf8'));
    merged = deepMerge(merged, fragment);
  }
  return merged;
}
```

- [ ] **Step 5: Declare the new exports in `lib/template.d.mts`**

Append:
```ts
export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Record<string, unknown>;

export function composePackageJson(
  fragmentPaths: string[]
): Promise<Record<string, unknown>>;
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/merge.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/create-hono-preact/package.json packages/create-hono-preact/lib/template.mjs packages/create-hono-preact/lib/template.d.mts packages/create-hono-preact/__tests__/merge.test.ts pnpm-lock.yaml
git commit -m "feat(create): add @clack/prompts and package.json deep-merge utils"
```

---

## Task 2: Restructure templates to base + overlays and add `scaffold()`

**Files:**
- Move/create under `packages/create-hono-preact/templates/` (see Step 1)
- Modify: `packages/create-hono-preact/lib/template.mjs` (add `copyTreeExcept`)
- Modify: `packages/create-hono-preact/lib/template.d.mts`
- Create: `packages/create-hono-preact/lib/scaffold.mjs`, `lib/scaffold.d.mts`
- Modify: `packages/create-hono-preact/lib/cli.mjs` (call `scaffold` instead of inline copy)
- Test: `packages/create-hono-preact/__tests__/scaffold.test.ts` (new)
- Modify: `packages/create-hono-preact/__tests__/scaffold-integration.test.ts` (new structure + UI variant)

**Interfaces:**
- Consumes: `deepMerge`, `composePackageJson` (Task 1).
- Produces:
  - `copyTreeExcept(source: string, target: string, exclude?: string[]): Promise<void>` — recursive copy, skipping files whose basename is in `exclude`, overwriting existing files.
  - `scaffold(targetDir: string, options: { adapter: 'cloudflare' | 'node', ui: boolean }, templatesRoot: string): Promise<void>` — compose base + overlays into `targetDir`.

- [ ] **Step 1: Restructure the template tree on disk**

Run from `packages/create-hono-preact`:
```bash
cd templates
mkdir -p base/src/pages adapter/cloudflare adapter/node feature/ui/src/pages

# Identical-across-adapters files -> base (move from cloudflare, drop node copies)
git mv cloudflare/tsconfig.json base/tsconfig.json
git mv cloudflare/src/Layout.tsx base/src/Layout.tsx
git mv cloudflare/src/api.ts base/src/api.ts
git mv cloudflare/src/routes.ts base/src/routes.ts
git mv cloudflare/src/pages/about.tsx base/src/pages/about.tsx
git mv cloudflare/src/pages/home.server.ts base/src/pages/home.server.ts
git mv cloudflare/src/pages/home.tsx base/src/pages/home.tsx
git mv cloudflare/_gitignore base/_gitignore           # keeps the .wrangler line (harmless for node)
git mv cloudflare/pnpm-workspace.yaml base/pnpm-workspace.yaml

git rm node/tsconfig.json node/src/Layout.tsx node/src/api.ts node/src/routes.ts \
       node/src/pages/about.tsx node/src/pages/home.server.ts node/src/pages/home.tsx \
       node/_gitignore node/pnpm-workspace.yaml

# Adapter-specific files -> adapter overlays
git mv cloudflare/vite.config.ts adapter/cloudflare/vite.config.ts
git mv cloudflare/wrangler.jsonc adapter/cloudflare/wrangler.jsonc
git mv cloudflare/README.md adapter/cloudflare/README.md
git mv node/vite.config.ts adapter/node/vite.config.ts
git mv node/README.md adapter/node/README.md

# Old per-adapter package.json files are replaced by fragments below
git rm cloudflare/package.json node/package.json
rmdir cloudflare/src/pages cloudflare/src node cloudflare 2>/dev/null || true
cd ..
```

- [ ] **Step 2: Write the base and fragment `package.json` files**

`templates/base/package.json`:
```json
{
  "name": "{{name}}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "hono": "^4.12.14",
    "hono-preact": "^0.8.0",
    "preact": "^10.29.1",
    "preact-iso": "github:preactjs/preact-iso#v3"
  },
  "devDependencies": {
    "@preact/preset-vite": "^2.10.5",
    "preact-render-to-string": "^6.6.7",
    "typescript": "^5.6.0",
    "vite": "^8.0.8"
  }
}
```

`templates/adapter/cloudflare/package.json`:
```json
{
  "scripts": {
    "preview": "vite preview",
    "deploy": "wrangler deploy -c dist/{{name_underscore}}/wrangler.json"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.37.1",
    "wrangler": "^4.92.0"
  }
}
```

`templates/adapter/node/package.json`:
```json
{
  "scripts": {
    "start": "node dist/server/server-entry.js"
  },
  "devDependencies": {
    "@hono/node-server": "^1.19.14",
    "@hono/node-ws": "^1.3.1"
  }
}
```

`templates/feature/ui/package.json`:
```json
{
  "dependencies": {
    "hono-preact-ui": "^0.2.0"
  }
}
```

- [ ] **Step 3: Make `templates/base/pnpm-workspace.yaml` adapter-neutral**

Replace its contents (the moved file mentions `workerd`, which is cloudflare-only) with:
```yaml
# pnpm 11 aborts `install` when a dependency ships an unreviewed build script
# (postinstall). This app's toolchain (esbuild and other native-binary packages)
# ships its binaries via platform-specific packages, so those scripts are safe to
# skip. Downgrade the abort to a warning; run `pnpm approve-builds` to opt a
# dependency in if you ever need its build step to run.
strictDepBuilds: false
```

- [ ] **Step 4: Write the UI overlay home page**

`templates/feature/ui/src/pages/home.tsx` (overwrites the base home page when UI is selected; keeps the loader pattern and adds a Dialog):
```tsx
import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import {
  DialogRoot,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogClose,
} from 'hono-preact-ui';
import { serverLoaders } from './home.server.js';

const homeLoader = serverLoaders.default;

const HomePage: FunctionComponent = () => {
  const { message, renderedAt } = homeLoader.useData();
  return (
    <section>
      <h1>Welcome to {'{{name}}'}</h1>
      <p>{message}</p>
      <p>
        <small>Rendered at {renderedAt}</small>
      </p>
      <DialogRoot>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogPopup
          aria-label="Demo dialog"
          style={{
            padding: '1.25rem',
            border: '1px solid #ccc',
            borderRadius: '8px',
            background: 'white',
          }}
        >
          <DialogTitle>hono-preact-ui</DialogTitle>
          <p>This dialog is a headless component from hono-preact-ui.</p>
          <DialogClose>Close</DialogClose>
        </DialogPopup>
      </DialogRoot>
      <p>
        <a href="/about">About</a>
      </p>
    </section>
  );
};
HomePage.displayName = 'HomePage';

const HomeView = homeLoader.View(() => <HomePage />, {
  fallback: <p>Loading...</p>,
});

export default definePage(HomeView, {});
```

- [ ] **Step 5: Add `copyTreeExcept` to `lib/template.mjs`**

Append (uses the `basename` import added in Task 1):
```js
/**
 * Recursively copy a template tree into the target, skipping files whose
 * basename appears in `exclude`. Existing files are overwritten (overlay
 * semantics); directories are always traversed.
 *
 * @param {string} source absolute path to the template tree
 * @param {string} target absolute path to the destination dir
 * @param {string[]} [exclude] basenames to skip (e.g. ['package.json'])
 */
export async function copyTreeExcept(source, target, exclude = []) {
  const skip = new Set(exclude);
  await cp(source, target, {
    recursive: true,
    filter: (src) => !skip.has(basename(src)),
  });
}
```
Add to `lib/template.d.mts`:
```ts
export function copyTreeExcept(
  source: string,
  target: string,
  exclude?: string[]
): Promise<void>;
```

- [ ] **Step 6: Write the failing scaffold test**

Create `packages/create-hono-preact/__tests__/scaffold.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold } from '../lib/scaffold.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templatesRoot = resolve(here, '..', 'templates');

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'chp-scaffold-'));
});
afterEach(() => rmSync(workDir, { recursive: true, force: true }));

function readPkg(dir: string) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

describe('scaffold', () => {
  it('cloudflare: writes wrangler.jsonc and cloudflare devDeps, no node deps', async () => {
    const target = join(workDir, 'cf');
    await scaffold(target, { adapter: 'cloudflare', ui: false }, templatesRoot);
    expect(existsSync(join(target, 'wrangler.jsonc'))).toBe(true);
    expect(existsSync(join(target, 'src', 'pages', 'home.tsx'))).toBe(true);
    const pkg = readPkg(target);
    expect(pkg.devDependencies).toHaveProperty('wrangler');
    expect(pkg.devDependencies).not.toHaveProperty('@hono/node-server');
    expect(pkg.scripts).toHaveProperty('deploy');
    expect(pkg.dependencies).not.toHaveProperty('hono-preact-ui');
    expect(pkg.name).toBe('cf');
  });

  it('node: writes node devDeps and start script, no wrangler.jsonc', async () => {
    const target = join(workDir, 'nd');
    await scaffold(target, { adapter: 'node', ui: false }, templatesRoot);
    expect(existsSync(join(target, 'wrangler.jsonc'))).toBe(false);
    const pkg = readPkg(target);
    expect(pkg.devDependencies).toHaveProperty('@hono/node-server');
    expect(pkg.devDependencies).not.toHaveProperty('wrangler');
    expect(pkg.scripts).toHaveProperty('start');
  });

  it('ui on: adds hono-preact-ui and a Dialog import in home.tsx', async () => {
    const target = join(workDir, 'ui');
    await scaffold(target, { adapter: 'node', ui: true }, templatesRoot);
    const pkg = readPkg(target);
    expect(pkg.dependencies).toHaveProperty('hono-preact-ui');
    const home = readFileSync(join(target, 'src', 'pages', 'home.tsx'), 'utf8');
    expect(home).toContain("from 'hono-preact-ui'");
    expect(home).toContain('DialogRoot');
  });

  it('ui off: home.tsx has no hono-preact-ui import', async () => {
    const target = join(workDir, 'noui');
    await scaffold(target, { adapter: 'node', ui: false }, templatesRoot);
    const home = readFileSync(join(target, 'src', 'pages', 'home.tsx'), 'utf8');
    expect(home).not.toContain('hono-preact-ui');
  });

  it('substitutes the project name and copies agent guidance', async () => {
    const target = join(workDir, 'my-app');
    await scaffold(target, { adapter: 'cloudflare', ui: false }, templatesRoot);
    expect(readPkg(target).name).toBe('my-app');
    expect(readFileSync(join(target, 'src', 'Layout.tsx'), 'utf8')).toContain('{{name}}');
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(target, '.gitignore'))).toBe(true);
  });
});
```

- [ ] **Step 7: Run it, verify it fails**

Run: `pnpm gen:agents-corpus && pnpm exec vitest run packages/create-hono-preact/__tests__/scaffold.test.ts`
Expected: FAIL with `Cannot find module '../lib/scaffold.mjs'`.

- [ ] **Step 8: Implement `lib/scaffold.mjs`**

```js
import { join, basename } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  copyTreeExcept,
  composePackageJson,
  renameDotfiles,
  substituteName,
  copyAgentGuidance,
} from './template.mjs';

/**
 * Compose a project from the base template plus the chosen adapter and feature
 * overlays. Every file except package.json copies with last-write-wins overlay
 * semantics; package.json is produced by deep-merging the per-overlay fragments.
 *
 * @param {string} targetDir absolute destination
 * @param {{ adapter: 'cloudflare' | 'node', ui: boolean }} options
 * @param {string} templatesRoot absolute path to templates/
 */
export async function scaffold(targetDir, options, templatesRoot) {
  const overlayDirs = [
    join(templatesRoot, 'base'),
    join(templatesRoot, 'adapter', options.adapter),
  ];
  if (options.ui) overlayDirs.push(join(templatesRoot, 'feature', 'ui'));

  await mkdir(targetDir, { recursive: true });

  for (const dir of overlayDirs) {
    await copyTreeExcept(dir, targetDir, ['package.json']);
  }

  const pkg = await composePackageJson(
    overlayDirs.map((dir) => join(dir, 'package.json'))
  );
  await writeFile(
    join(targetDir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );

  await renameDotfiles(targetDir);
  await substituteName(targetDir, basename(targetDir));
  await copyAgentGuidance(join(templatesRoot, 'agents'), targetDir, {
    force: true,
  });
}
```
Create `lib/scaffold.d.mts`:
```ts
export function scaffold(
  targetDir: string,
  options: { adapter: 'cloudflare' | 'node'; ui: boolean },
  templatesRoot: string
): Promise<void>;
```

- [ ] **Step 9: Run the scaffold test, verify it passes**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/scaffold.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 10: Rewire `lib/cli.mjs` to call `scaffold()`**

In `lib/cli.mjs`, replace the inline scaffold block. Change the imports: replace
```js
import {
  copyTemplate,
  renameDotfiles,
  substituteName,
  copyAgentGuidance,
} from './template.mjs';
```
with
```js
import { copyAgentGuidance } from './template.mjs';
import { scaffold } from './scaffold.mjs';
```
Then replace these lines in `run()`:
```js
  const sourceTemplate = join(templatesRoot, adapter);
  await copyTemplate(sourceTemplate, targetPath);
  await renameDotfiles(targetPath);
  await substituteName(targetPath, basename(targetPath));
  await copyAgentGuidance(join(templatesRoot, 'agents'), targetPath, {
    force: true,
  });
```
with
```js
  await scaffold(targetPath, { adapter, ui: false }, templatesRoot);
```
(`copyAgentGuidance` is still imported because the `add-agents` subcommand uses it. `basename`/`join` may now be unused in `cli.mjs`; leave `join` if `add-agents` still needs it, otherwise drop unused imports to keep `pnpm typecheck` clean.)

- [ ] **Step 11: Run the existing CLI unit tests, verify still green**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/cli.test.ts`
Expected: PASS (all existing tests; `--adapter=cloudflare|node`, default-adapter, file presence, add-agents unchanged).

- [ ] **Step 12: Update the integration test for the new structure + UI build**

In `__tests__/scaffold-integration.test.ts`:

(a) In `beforeAll`, add `hono-preact-ui` to the build filter list and pack it. After the existing hono-preact pack, add:
```ts
  execFileSync(
    'pnpm',
    ['pack', '--filter', 'hono-preact-ui', '--pack-destination', packDir],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  const uiTgz = readdirSync(packDir).find(
    (f) => f.startsWith('hono-preact-ui-') && f.endsWith('.tgz')
  );
  if (!uiTgz) throw new Error('failed to locate packed hono-preact-ui tarball');
  uiTarballPath = join(packDir, uiTgz);
```
Add `--filter hono-preact-ui` to the build `execFileSync` arg list, and declare `let uiTarballPath: string;` near `let tarballPath: string;`.

(b) Extend the `scaffold` helper with a `ui` parameter that rewrites both tarball deps:
```ts
async function scaffold(
  name: string,
  adapter: 'cloudflare' | 'node',
  ui = false
): Promise<string> {
  const argv = [name, `--adapter=${adapter}`, '--no-install', '--no-git'];
  if (ui) argv.push('--ui');
  const code = await run({ argv, cwd: workDir, env: {} });
  if (code !== 0) throw new Error(`scaffold failed with code ${code}`);

  const target = join(workDir, name);
  const pkgPath = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies['hono-preact'] = `file:${tarballPath}`;
  if (ui) pkg.dependencies['hono-preact-ui'] = `file:${uiTarballPath}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  return target;
}
```
(Note: this step uses the `--ui` flag, which Task 3 adds to `parseArgs`. Until Task 3 lands, run this integration test only after Task 3. If executing strictly in order, defer running the new UI assertion to Task 3, Step 8.)

(c) Change the cloudflare test to scaffold with `ui: true` and assert the Dialog import survives the build:
```ts
    const target = await scaffold('integration-cf', 'cloudflare', true);
```
After the build assertions add:
```ts
    const home = readFileSync(join(target, 'src', 'pages', 'home.tsx'), 'utf8');
    expect(home).toContain('hono-preact-ui');
```

- [ ] **Step 13: Run the integration test**

Run: `pnpm test:integration` (or `pnpm exec vitest run packages/create-hono-preact/__tests__/scaffold-integration.test.ts`)
Expected: PASS. The cloudflare case builds a UI-enabled app; the node case builds a plain app.
(If running strictly in order before Task 3, temporarily drop the `--ui` from the helper and the cloudflare assertion, then restore them at Task 3 Step 8.)

- [ ] **Step 14: Commit**

```bash
git add packages/create-hono-preact/templates packages/create-hono-preact/lib packages/create-hono-preact/__tests__/scaffold.test.ts packages/create-hono-preact/__tests__/scaffold-integration.test.ts
git commit -m "feat(create): base + adapter/ui template overlays with scaffold()"
```

---

## Task 3: Rewrite `parseArgs` for the new flag set

**Files:**
- Modify: `packages/create-hono-preact/lib/args.mjs`
- Modify: `packages/create-hono-preact/lib/args.d.mts`
- Modify: `packages/create-hono-preact/lib/cli.mjs` (consume new shape; temporary defaults)
- Test: `packages/create-hono-preact/__tests__/args.test.ts`

**Interfaces:**
- Produces: `parseArgs(argv: string[])` returns one of:
  - `{ kind: 'help' }`
  - `{ kind: 'version' }`
  - `{ kind: 'error', message: string }`
  - `{ kind: 'add-agents', force: boolean }`
  - `{ kind: 'scaffold', targetDir?: string, adapter?: 'cloudflare' | 'node', ui?: boolean, install?: boolean, git?: boolean, yes: boolean, skipHints: boolean }`
  - `adapter`/`ui`/`install`/`git` are `undefined` when not specified. `install`/`git` are `false` only via `--no-install`/`--no-git`; `ui` is `true`/`false` via `--ui`/`--no-ui`. Accepts both `--adapter node` and `--adapter=node`.

- [ ] **Step 1: Write/extend the failing tests**

In `__tests__/args.test.ts`, replace the body of the `describe('parseArgs', ...)` scaffold expectations to match the new shape and add the new-flag cases. Key cases:
```ts
  it('parses a bare positional target dir with undefined optionals', () => {
    expect(parseArgs(['my-app'])).toEqual({
      kind: 'scaffold',
      targetDir: 'my-app',
      adapter: undefined,
      ui: undefined,
      install: undefined,
      git: undefined,
      yes: false,
      skipHints: false,
    });
  });

  it('accepts --adapter node (space form)', () => {
    expect(parseArgs(['my-app', '--adapter', 'node']).adapter).toBe('node');
  });

  it('accepts --adapter=cloudflare (equals form)', () => {
    expect(parseArgs(['my-app', '--adapter=cloudflare']).adapter).toBe('cloudflare');
  });

  it('rejects an unknown adapter', () => {
    const r = parseArgs(['my-app', '--adapter=deno']);
    expect(r.kind).toBe('error');
  });

  it('--ui sets ui true, --no-ui sets ui false', () => {
    expect(parseArgs(['a', '--ui']).ui).toBe(true);
    expect(parseArgs(['a', '--no-ui']).ui).toBe(false);
  });

  it('--no-install / --no-git set those false; otherwise undefined', () => {
    expect(parseArgs(['a', '--no-install']).install).toBe(false);
    expect(parseArgs(['a', '--no-git']).git).toBe(false);
    expect(parseArgs(['a']).install).toBe(undefined);
    expect(parseArgs(['a']).git).toBe(undefined);
  });

  it('-y / --yes set yes; --skip-hints sets skipHints', () => {
    expect(parseArgs(['a', '-y']).yes).toBe(true);
    expect(parseArgs(['a', '--yes']).yes).toBe(true);
    expect(parseArgs(['a', '--skip-hints']).skipHints).toBe(true);
  });

  it('still returns help/version', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
  });

  it('rejects unknown flags and extra positionals', () => {
    expect(parseArgs(['a', '--bogus']).kind).toBe('error');
    expect(parseArgs(['a', 'b']).kind).toBe('error');
  });
```
Keep the existing `add-agents` describe block unchanged.

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/args.test.ts`
Expected: FAIL (old shape returns `adapter: 'cloudflare'`, no `ui`/`yes`/`skipHints`).

- [ ] **Step 3: Rewrite `parseArgs` in `lib/args.mjs`**

Keep the `add-agents` branch as-is. Replace the scaffold-parsing body with:
```js
  let targetDir;
  /** @type {'cloudflare' | 'node' | undefined} */
  let adapter;
  /** @type {boolean | undefined} */
  let ui;
  /** @type {boolean | undefined} */
  let install;
  /** @type {boolean | undefined} */
  let git;
  let yes = false;
  let skipHints = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    if (arg === '--version' || arg === '-v') return { kind: 'version' };
    if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg === '--skip-hints') {
      skipHints = true;
    } else if (arg === '--no-install') {
      install = false;
    } else if (arg === '--no-git') {
      git = false;
    } else if (arg === '--ui') {
      ui = true;
    } else if (arg === '--no-ui') {
      ui = false;
    } else if (arg === '--adapter' || arg.startsWith('--adapter=')) {
      const value = arg.includes('=')
        ? arg.slice('--adapter='.length)
        : argv[++i];
      if (value !== 'cloudflare' && value !== 'node') {
        return {
          kind: 'error',
          message: `unknown adapter: ${value} (expected 'cloudflare' or 'node')`,
        };
      }
      adapter = value;
    } else if (arg.startsWith('-')) {
      return { kind: 'error', message: `unknown flag: ${arg}` };
    } else if (targetDir === undefined) {
      targetDir = arg;
    } else {
      return {
        kind: 'error',
        message: `unexpected positional argument: ${arg}`,
      };
    }
  }

  return { kind: 'scaffold', targetDir, adapter, ui, install, git, yes, skipHints };
```

- [ ] **Step 4: Update `lib/args.d.mts`**

```ts
export interface ParsedArgs {
  kind: 'help' | 'version' | 'error' | 'scaffold' | 'add-agents';
  targetDir?: string | undefined;
  adapter?: 'cloudflare' | 'node' | undefined;
  ui?: boolean | undefined;
  install?: boolean | undefined;
  git?: boolean | undefined;
  yes?: boolean;
  skipHints?: boolean;
  message?: string;
  force?: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs;
```

- [ ] **Step 5: Add temporary defaults in `lib/cli.mjs` so non-interactive behavior is unchanged**

In `run()`, where it currently destructures `parsed`:
```js
  let { targetDir, adapter, install, git } = parsed;
```
replace with (apply the documented defaults; interactive prompting arrives in Task 4):
```js
  let { targetDir } = parsed;
  const adapter = parsed.adapter ?? 'cloudflare';
  const ui = parsed.ui ?? false;
  const install = parsed.install ?? true;
  const git = parsed.git ?? true;
```
Update the scaffold call to use `ui`:
```js
  await scaffold(targetPath, { adapter, ui }, templatesRoot);
```
The existing missing-`targetDir` prompt block (readline) stays for now; Task 4 replaces it.

- [ ] **Step 6: Update the help text in `lib/cli.mjs`**

Replace the `printHelp` Options block to list the new flags:
```js
Options:
  --adapter <cloudflare|node>   pick the deployment target (default: cloudflare)
  --ui, --no-ui                 include or exclude hono-preact-ui components
  --no-install                  skip dependency install
  --no-git                      skip 'git init'
  -y, --yes                     accept defaults for anything not specified
  --skip-hints                  suppress the "Next steps" note
  -h, --help                    show this help
  -v, --version                 show version
```

- [ ] **Step 7: Run unit tests, verify green**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/args.test.ts packages/create-hono-preact/__tests__/cli.test.ts`
Expected: PASS. (cli.test.ts still drives `--adapter=node`, `--no-install`, `--no-git`; defaults resolve as before.)

- [ ] **Step 8: Run the full integration test with the `--ui` path enabled**

If you deferred the UI assertions in Task 2 Step 12/13, restore them now and run:
Run: `pnpm test:integration`
Expected: PASS, including the cloudflare+UI build.

- [ ] **Step 9: Commit**

```bash
git add packages/create-hono-preact/lib/args.mjs packages/create-hono-preact/lib/args.d.mts packages/create-hono-preact/lib/cli.mjs packages/create-hono-preact/__tests__/args.test.ts packages/create-hono-preact/__tests__/scaffold-integration.test.ts
git commit -m "feat(create): parseArgs supports --ui, --yes, --skip-hints, space-form --adapter"
```

---

## Task 4: Interactive resolution, clack prompt shell, and CLI wiring

**Files:**
- Create: `packages/create-hono-preact/lib/resolve.mjs`, `lib/resolve.d.mts`
- Create: `packages/create-hono-preact/lib/prompts.mjs`, `lib/prompts.d.mts`
- Modify: `packages/create-hono-preact/lib/cli.mjs`, `lib/cli.d.mts`
- Modify: `packages/create-hono-preact/bin/index.mjs`
- Test: `packages/create-hono-preact/__tests__/resolve.test.ts` (new)
- Modify: `packages/create-hono-preact/__tests__/cli.test.ts` (add interactive cases)

**Interfaces:**
- Consumes: `parseArgs` shape (Task 3), `scaffold` (Task 2).
- Produces:
  - `PromptAdapter` shape: `{ text({message,placeholder,validate}): Promise<string>; selectAdapter(): Promise<'cloudflare'|'node'>; confirm({message,initialValue}): Promise<boolean>; intro(message): void; outro(message): void; note(message,title): void; spinner(): { start(msg:string):void; stop(msg:string):void } }`
  - `resolveOptions(parsed, { interactive: boolean, prompts: PromptAdapter }): Promise<ResolvedOptions>` where `ResolvedOptions = { targetDir: string, adapter: 'cloudflare'|'node', ui: boolean, install: boolean, git: boolean, skipHints: boolean }`. Throws `Error` with a leading `error:` message when `targetDir` is missing and non-interactive.
  - `clackPrompts: PromptAdapter` and `brandBanner: string` from `prompts.mjs`.
  - `run({ argv, cwd, env, isTTY?, prompts?, spawnFn? })` gains `isTTY` (default `false`) and `prompts` (default `clackPrompts`).

- [ ] **Step 1: Write the failing `resolveOptions` test**

Create `packages/create-hono-preact/__tests__/resolve.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveOptions } from '../lib/resolve.mjs';

function stubPrompts(overrides = {}) {
  return {
    text: vi.fn(async () => 'prompted-dir'),
    selectAdapter: vi.fn(async () => 'node' as const),
    confirm: vi.fn(async () => true),
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(),
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
    ...overrides,
  };
}

const base = { yes: false, skipHints: false };

describe('resolveOptions — non-interactive', () => {
  it('applies defaults and never prompts', async () => {
    const prompts = stubPrompts();
    const opts = await resolveOptions(
      { ...base, targetDir: 'app' },
      { interactive: false, prompts }
    );
    expect(opts).toEqual({
      targetDir: 'app',
      adapter: 'cloudflare',
      ui: false,
      install: true,
      git: true,
      skipHints: false,
    });
    expect(prompts.text).not.toHaveBeenCalled();
    expect(prompts.selectAdapter).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
  });

  it('throws when targetDir is missing', async () => {
    await expect(
      resolveOptions({ ...base }, { interactive: false, prompts: stubPrompts() })
    ).rejects.toThrow(/project directory is required/i);
  });

  it('flag values override defaults', async () => {
    const opts = await resolveOptions(
      { ...base, targetDir: 'app', adapter: 'node', ui: true, install: false, git: false },
      { interactive: false, prompts: stubPrompts() }
    );
    expect(opts).toMatchObject({ adapter: 'node', ui: true, install: false, git: false });
  });
});

describe('resolveOptions — interactive', () => {
  it('prompts only for fields not supplied by flags', async () => {
    const prompts = stubPrompts();
    const opts = await resolveOptions(
      { ...base, adapter: 'cloudflare' }, // adapter supplied; dir/ui/install/git prompted
      { interactive: true, prompts }
    );
    expect(prompts.text).toHaveBeenCalledTimes(1); // dir
    expect(prompts.selectAdapter).not.toHaveBeenCalled(); // adapter came from flag
    expect(prompts.confirm).toHaveBeenCalledTimes(3); // ui, install, git
    expect(opts).toEqual({
      targetDir: 'prompted-dir',
      adapter: 'cloudflare',
      ui: true,
      install: true,
      git: true,
      skipHints: false,
    });
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/resolve.test.ts`
Expected: FAIL with `Cannot find module '../lib/resolve.mjs'`.

- [ ] **Step 3: Implement `lib/resolve.mjs`**

```js
/**
 * @typedef {Object} ResolvedOptions
 * @property {string} targetDir
 * @property {'cloudflare' | 'node'} adapter
 * @property {boolean} ui
 * @property {boolean} install
 * @property {boolean} git
 * @property {boolean} skipHints
 */

/**
 * Resolve parsed flags into a complete option set. In interactive mode, prompt
 * for any field a flag did not supply. In non-interactive mode, fill defaults
 * (adapter cloudflare, ui off, install on, git on); a missing target directory
 * is an error.
 *
 * @param {{ targetDir?: string, adapter?: 'cloudflare' | 'node', ui?: boolean, install?: boolean, git?: boolean, skipHints?: boolean }} parsed
 * @param {{ interactive: boolean, prompts: import('./prompts.mjs').PromptAdapter }} ctx
 * @returns {Promise<ResolvedOptions>}
 */
export async function resolveOptions(parsed, { interactive, prompts }) {
  let targetDir = parsed.targetDir;
  if (!targetDir) {
    if (!interactive) {
      throw new Error('error: a project directory is required');
    }
    targetDir = await prompts.text({
      message: 'Project directory:',
      placeholder: 'my-app',
      validate: (v) =>
        v.length === 0 ? 'A project directory is required.' : undefined,
    });
  }

  let adapter = parsed.adapter;
  if (adapter === undefined) {
    adapter = interactive ? await prompts.selectAdapter() : 'cloudflare';
  }

  let ui = parsed.ui;
  if (ui === undefined) {
    ui = interactive
      ? await prompts.confirm({
          message: 'Add hono-preact-ui components?',
          initialValue: false,
        })
      : false;
  }

  let install = parsed.install;
  if (install === undefined) {
    install = interactive
      ? await prompts.confirm({
          message: 'Install dependencies now?',
          initialValue: true,
        })
      : true;
  }

  let git = parsed.git;
  if (git === undefined) {
    git = interactive
      ? await prompts.confirm({
          message: 'Initialize a git repository?',
          initialValue: true,
        })
      : true;
  }

  return { targetDir, adapter, ui, install, git, skipHints: Boolean(parsed.skipHints) };
}
```
Create `lib/resolve.d.mts`:
```ts
import type { PromptAdapter } from './prompts.mjs';

export interface ResolvedOptions {
  targetDir: string;
  adapter: 'cloudflare' | 'node';
  ui: boolean;
  install: boolean;
  git: boolean;
  skipHints: boolean;
}

export function resolveOptions(
  parsed: {
    targetDir?: string;
    adapter?: 'cloudflare' | 'node';
    ui?: boolean;
    install?: boolean;
    git?: boolean;
    skipHints?: boolean;
  },
  ctx: { interactive: boolean; prompts: PromptAdapter }
): Promise<ResolvedOptions>;
```

- [ ] **Step 4: Run the resolve test, verify it passes**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/resolve.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Implement `lib/prompts.mjs` (clack shell)**

```js
import * as clack from '@clack/prompts';
import pc from 'picocolors';

/**
 * Exit cleanly if the user cancelled a clack prompt (Ctrl-C).
 *
 * @template T
 * @param {T | symbol} value
 * @returns {T}
 */
function guard(value) {
  if (clack.isCancel(value)) {
    clack.cancel('Cancelled');
    process.exit(0);
  }
  return /** @type {T} */ (value);
}

/** @type {import('./prompts.mjs').PromptAdapter} */
export const clackPrompts = {
  intro: (message) => clack.intro(message),
  outro: (message) => clack.outro(message),
  note: (message, title) => clack.note(message, title),
  spinner: () => clack.spinner(),
  text: async (opts) => guard(await clack.text(opts)),
  selectAdapter: async () =>
    guard(
      await clack.select({
        message: 'Adapter:',
        initialValue: 'cloudflare',
        options: [
          { value: 'cloudflare', label: 'Cloudflare Workers' },
          { value: 'node', label: 'Node server' },
        ],
      })
    ),
  confirm: async (opts) => guard(await clack.confirm(opts)),
};

export const brandBanner = pc.cyan(pc.bold('create-hono-preact'));
```
Create `lib/prompts.d.mts`:
```ts
export interface PromptAdapter {
  text(opts: {
    message: string;
    placeholder?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string>;
  selectAdapter(): Promise<'cloudflare' | 'node'>;
  confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean>;
  intro(message: string): void;
  outro(message: string): void;
  note(message: string, title?: string): void;
  spinner(): { start(message: string): void; stop(message: string): void };
}

export const clackPrompts: PromptAdapter;
export const brandBanner: string;
```

- [ ] **Step 6: Wire interactive flow into `lib/cli.mjs`**

Add imports:
```js
import { resolveOptions } from './resolve.mjs';
import { clackPrompts, brandBanner } from './prompts.mjs';
```
Change the `run` signature to accept `isTTY` and `prompts`:
```js
export async function run({
  argv,
  cwd,
  env,
  isTTY = false,
  prompts = clackPrompts,
  spawnFn = realSpawn,
}) {
```
Replace the Task 3 temporary-default block and the readline prompt block with the interactive resolution:
```js
  const interactive = Boolean(isTTY) && !parsed.yes;
  if (interactive) prompts.intro(brandBanner);

  /** @type {import('./resolve.mjs').ResolvedOptions} */
  let options;
  try {
    options = await resolveOptions(parsed, { interactive, prompts });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const { targetDir, adapter, ui, install, git, skipHints } = options;
```
Replace the scaffold + install + git + next-steps block with spinner-aware logic:
```js
  const targetPath = resolve(cwd, targetDir);
  try {
    const entries = await readdir(targetPath);
    if (entries.length > 0) {
      console.error(`error: target directory '${targetDir}' is not empty`);
      return 1;
    }
  } catch (err) {
    if (!(err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT')) {
      throw err;
    }
  }

  const spin = interactive ? prompts.spinner() : null;
  spin?.start('Scaffolding project...');
  await scaffold(targetPath, { adapter, ui }, templatesRoot);
  spin?.stop('Project scaffolded');

  const pm = detectPackageManager(env);
  const childStdio = interactive ? 'ignore' : 'inherit';

  if (install) {
    spin?.start('Installing dependencies...');
    const code = await runChild(spawnFn, pm, ['install'], targetPath, childStdio);
    spin?.stop('Dependencies installed');
    if (code !== 0) return 1;
  }

  if (git) {
    const code = await runChild(spawnFn, 'git', ['init'], targetPath, childStdio);
    if (code !== 0) {
      console.warn(
        'warning: git init failed (is git installed?); continuing without git'
      );
    }
  }

  if (!skipHints) {
    if (interactive) {
      const dev = pm === 'npm' ? 'npm run dev' : `${pm} dev`;
      const lines = [`cd ${targetDir}`];
      if (!install) lines.push(pm === 'npm' ? 'npm install' : `${pm} install`);
      lines.push(dev);
      prompts.note(lines.map((l) => `  ${l}`).join('\n'), 'Next steps');
    } else {
      printNextSteps(targetDir, pm, install);
    }
  }

  if (interactive) prompts.outro(pc.green("You're all set!"));
  return 0;
```
Update `runChild` to take a `stdio` argument:
```js
function runChild(spawnFn, cmd, args, cwd, stdio = 'inherit') {
  return new Promise((res) => {
    const child = spawnFn(cmd, args, { cwd, stdio });
    // ... unchanged close/error handling ...
  });
}
```
Remove the now-unused `defaultPrompt`/`readline` import. Update `lib/cli.d.mts` to add `isTTY?: boolean` and `prompts?: import('./prompts.mjs').PromptAdapter` to the `run` options type.

- [ ] **Step 7: Pass `isTTY` from `bin/index.mjs`**

```js
#!/usr/bin/env node
import { run } from '../lib/cli.mjs';

run({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  isTTY: process.stdout.isTTY === true,
}).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  }
);
```

- [ ] **Step 8: Add interactive CLI tests**

Append to `__tests__/cli.test.ts` a describe block that injects a fake `prompts` and `isTTY: true`:
```ts
function fakePrompts(answers: {
  dir?: string;
  adapter?: 'cloudflare' | 'node';
  ui?: boolean;
  install?: boolean;
  git?: boolean;
}) {
  const calls = { text: 0, selectAdapter: 0, confirm: 0 };
  return {
    calls,
    prompts: {
      text: async () => {
        calls.text++;
        return answers.dir ?? 'prompted-app';
      },
      selectAdapter: async () => {
        calls.selectAdapter++;
        return answers.adapter ?? 'cloudflare';
      },
      confirm: async ({ message }: { message: string }) => {
        calls.confirm++;
        if (/ui|components/i.test(message)) return answers.ui ?? false;
        if (/install/i.test(message)) return answers.install ?? true;
        return answers.git ?? true;
      },
      intro: () => {},
      outro: () => {},
      note: () => {},
      spinner: () => ({ start: () => {}, stop: () => {} }),
    },
  };
}

describe('run() — interactive wizard', () => {
  it('prompts for dir + adapter + ui and scaffolds a node+ui app', async () => {
    const fake = fakePrompts({ dir: 'wiz-app', adapter: 'node', ui: true });
    const code = await run({
      argv: ['--no-install', '--no-git'],
      cwd: workDir,
      env: {},
      isTTY: true,
      prompts: fake.prompts as never,
    });
    expect(code).toBe(0);
    const target = join(workDir, 'wiz-app');
    expect(existsSync(join(target, 'wrangler.jsonc'))).toBe(false); // node
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toHaveProperty('hono-preact-ui'); // ui on
    expect(fake.calls.text).toBe(1); // dir prompted
    expect(fake.calls.selectAdapter).toBe(1); // adapter prompted
  });

  it('does not prompt for a value supplied by a flag', async () => {
    const fake = fakePrompts({ dir: 'flagged' });
    await run({
      argv: ['flagged', '--adapter=cloudflare', '--no-ui', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
      isTTY: true,
      prompts: fake.prompts as never,
    });
    expect(fake.calls.text).toBe(0); // dir came from positional
    expect(fake.calls.selectAdapter).toBe(0); // adapter from flag
  });
});
```

- [ ] **Step 9: Run the CLI unit suite, verify green**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/cli.test.ts packages/create-hono-preact/__tests__/resolve.test.ts`
Expected: PASS (existing non-interactive tests unchanged + new interactive tests).

- [ ] **Step 10: Manual real-world smoke check**

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null
npm install /ABS/PATH/TO/worktree/packages/create-hono-preact >/dev/null 2>&1
printf '\n' | npm create hono-preact smoke-app -- --adapter node --ui --no-install --no-git
ls smoke-app   # expect a node app with hono-preact-ui in package.json; no npm "--" warning when no bare flags are used
```
Expected: scaffolds correctly; the flag-free form (`npm create hono-preact`) prompts with no npm warning.

- [ ] **Step 11: Commit**

```bash
git add packages/create-hono-preact/lib packages/create-hono-preact/bin/index.mjs packages/create-hono-preact/__tests__/resolve.test.ts packages/create-hono-preact/__tests__/cli.test.ts
git commit -m "feat(create): interactive @clack/prompts wizard over a pure resolve core"
```

---

## Task 5: Documentation + bundled corpus

**Files:**
- Modify: `README.md` (root), `packages/create-hono-preact/README.md`
- Modify: `apps/site/src/pages/docs/cli.mdx`, `apps/site/src/pages/docs/quick-start.mdx`
- Regenerate: `packages/create-hono-preact/templates/agents/llms-full.txt` (gitignored)

- [ ] **Step 1: Rewrite the CLI reference (`apps/site/src/pages/docs/cli.mdx`)**

Lead with the interactive flow; keep a flag table for scripting. Replace the "Create a new app" section with:
````md
## Create a new app

```bash
npm create hono-preact
```

Run with no arguments and the wizard walks you through it: project directory,
adapter (Cloudflare Workers or a Node server), whether to add `hono-preact-ui`
components, and whether to install dependencies and initialize git. Because the
common path takes no flags, there is nothing for npm to mis-parse.

You can pass a directory and skip prompts with flags for scripting or CI:

```bash
# pnpm/yarn/bun forward flags directly:
pnpm create hono-preact my-app --adapter node --ui --yes
# npm needs a `--` separator before tool flags:
npm create hono-preact my-app -- --adapter node --ui --yes
```

### Options

| Flag | Description |
| --- | --- |
| `--adapter <cloudflare\|node>` | Choose the deployment target (prompted otherwise). |
| `--ui`, `--no-ui` | Include or exclude `hono-preact-ui` components. |
| `--no-install` | Skip the dependency install step. |
| `--no-git` | Skip `git init`. |
| `-y`, `--yes` | Accept defaults for anything not specified (no prompts). |
| `--skip-hints` | Suppress the "Next steps" note. |
| `--version`, `-v` | Print the CLI version. |
| `--help`, `-h` | Print usage. |

> In a non-interactive shell (CI, piped input), the CLI never prompts: it uses
> your flags plus defaults (adapter `cloudflare`, UI off, install on, git on),
> and a missing directory is an error. With `npm`, put tool flags after `--`.
````
Keep the existing `add-agents` section unchanged.

- [ ] **Step 2: Update `apps/site/src/pages/docs/quick-start.mdx`**

Replace the scaffold paragraph (around the `pnpm create hono-preact my-app` block) so it mentions the wizard and the adapter prompt:
```md
Scaffold a new app. Run it with no arguments to use the interactive wizard, or
pass a directory:

```bash
pnpm create hono-preact my-app
cd my-app
```

The wizard asks for the adapter (Cloudflare Workers or Node), whether to add
`hono-preact-ui` components, and whether to install dependencies and init git.
To script it, pass flags instead (`--adapter node`, `--ui`, `--yes`); with npm,
put them after `--`. See [Build & Deploy](./deployment) for the deployment side.
```

- [ ] **Step 3: Update the root `README.md` Quick start**

Replace the create block and Options list:
```md
The fastest way to start is the scaffolder. Run it with no arguments for the
interactive wizard, or pass a directory:

```bash
npm create hono-preact
# or: pnpm create hono-preact my-app
```

The wizard picks the adapter (Cloudflare Workers or Node), optional
`hono-preact-ui` components, and whether to install and init git. For scripting,
every prompt has a flag (`--adapter`, `--ui`/`--no-ui`, `--no-install`,
`--no-git`, `--yes`); with npm, pass tool flags after `--`
(`npm create hono-preact my-app -- --adapter node`). pnpm, yarn, and bun forward
them directly.

Full CLI reference: [Docs · CLI](https://framework.sbesh.com/docs/cli).
```

- [ ] **Step 4: Update `packages/create-hono-preact/README.md`**

```md
# create-hono-preact

Scaffold a new hono-preact app. Run with no arguments for the interactive
wizard, or pass a directory.

```bash
npm create hono-preact
pnpm create hono-preact my-app
```

## Flags (scripted/CI)

- `--adapter <cloudflare|node>` pick the deployment target (prompted otherwise)
- `--ui`, `--no-ui` include or exclude hono-preact-ui components
- `--no-install` skip the package-manager install step
- `--no-git` skip `git init`
- `-y`, `--yes` accept defaults for anything not specified
- `--skip-hints` suppress the "Next steps" note
- `--help`, `--version`

> With npm, put tool flags after `--`: `npm create hono-preact my-app -- --adapter node`.
> pnpm, yarn, and bun forward bare flags directly.

See [https://framework.sbesh.com/docs](https://framework.sbesh.com/docs) for the framework documentation.
```

- [ ] **Step 5: Regenerate the corpus and verify docs build**

Run:
```bash
pnpm gen:agents-corpus
pnpm --filter site build
```
Expected: corpus regenerated; site builds clean.

- [ ] **Step 6: Commit**

```bash
git add README.md packages/create-hono-preact/README.md apps/site/src/pages/docs/cli.mdx apps/site/src/pages/docs/quick-start.mdx
git commit -m "docs(create): rewrite CLI docs around the interactive wizard"
```

---

## Task 6: Full CI-parity verification

**Files:** none (verification + cleanup only).

- [ ] **Step 1: Run the eight pre-push steps in order**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all green. If `format:check` fails, run `pnpm format`, re-check, and amend/commit.

- [ ] **Step 2: Confirm the wizard end-to-end once more in a TTY** (manual)

In a real terminal, run `node packages/create-hono-preact/bin/index.mjs` in a temp dir and walk the prompts; confirm a scaffolded app, then `--ui` produces a Dialog in `home.tsx`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin worktree-create-cli-interactive
gh pr create --base main --title "feat(create-hono-preact): interactive wizard CLI"
```
For the PR body, summarize: the interactive `@clack/prompts` wizard, the retained scripted/CI flag path, the base+overlay template restructure, the UI overlay, and that it supersedes PR #190 (the npm flag-recovery hack, no longer needed because the happy path is flag-free). Run the deep PR review (REVIEW.md) as the first follow-up step.

- [ ] **Step 4: Supersede PR #190**

Close PR #190 with a note pointing here (it is replaced by the interactive wizard; the npm `--` recovery is no longer needed because the happy path is flag-free).

---

## Self-review notes

- **Spec coverage:** wizard (Task 4), flags + non-interactive (Tasks 3-4), base+overlay templates + merge (Tasks 1-2), UI overlay (Task 2/4), code structure incl. `resolve.mjs`/`prompts.mjs`/`scaffold.mjs` (Tasks 2-4), `@clack/prompts`-only dependency (Task 1), testing matrix incl. `resolve`/`merge`/adapter×ui integration (Tasks 1-4), docs + corpus (Task 5), CI gate + #190 supersede (Task 6). The spec named `resolveOptions` as living in `prompts.mjs`; this plan splits it into a clack-free `resolve.mjs` so its unit tests do not load `@clack/prompts` (better isolation; same behavior).
- **Type consistency:** `parseArgs` scaffold shape (Task 3) is consumed verbatim by `resolveOptions` (Task 4); `ResolvedOptions` fields match what `cli.run()` destructures; `scaffold(targetDir, {adapter, ui}, templatesRoot)` signature is identical in Tasks 2 and 4; `PromptAdapter` is defined once (Task 4) and used by the fake in `cli.test.ts`.
- **Ordering caveat:** Task 2's integration test uses the `--ui` flag added in Task 3; the plan flags this in Task 2 Step 12 and restores assertions in Task 3 Step 8.
