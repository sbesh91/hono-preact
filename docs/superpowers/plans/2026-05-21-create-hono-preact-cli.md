# `create-hono-preact` CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `create-hono-preact` CLI as a new package in the monorepo, with two adapter-specific minimal-demo templates and a CI gate that scaffolds + installs + builds each adapter.

**Architecture:** New package `packages/create-hono-preact`, plain Node ESM (no build step). `bin/index.mjs` is a thin shim that calls `lib/cli.mjs`'s exported `run()` orchestrator. Pure helpers (`parseArgs`, `detectPackageManager`, template ops) live in sibling `lib/*.mjs` modules so they unit-test cleanly. Templates are checked-in file trees with `_gitignore` dotfile rename and `{{name}}` placeholder substitution at copy time.

**Tech Stack:** Node 20+, plain JS ESM (`.mjs`), `picocolors`, `node:fs`/`node:child_process`/`node:readline`. Tests in TypeScript via vitest (matches repo convention).

**Spec:** `docs/superpowers/specs/2026-05-21-create-hono-preact-cli-design.md`
**Issue:** [#47](https://github.com/sbesh91/hono-preact/issues/47)

---

## File Structure

```
packages/create-hono-preact/
  package.json
  README.md
  bin/
    index.mjs                          # shebang + run() invocation
  lib/
    cli.mjs                            # exports run({ argv, cwd, env, prompt }); orchestrator
    args.mjs                           # exports parseArgs(argv); pure
    detect-pm.mjs                      # exports detectPackageManager(env); pure
    template.mjs                       # exports copyTemplate, renameDotfiles, substituteName
  templates/
    cloudflare/
      _gitignore
      package.json                     # name: "{{name}}"
      tsconfig.json
      vite.config.ts
      wrangler.jsonc                   # name: "{{name}}"
      README.md
      src/
        api.ts                         # empty Hono + GET /healthz
        Layout.tsx
        routes.ts
        pages/
          home.tsx
          home.server.ts
          about.tsx
    node/
      _gitignore
      package.json                     # name: "{{name}}"
      tsconfig.json
      vite.config.ts
      README.md
      src/
        api.ts
        Layout.tsx
        routes.ts
        pages/
          home.tsx
          home.server.ts
          about.tsx
  __tests__/
    args.test.ts                       # parseArgs unit tests
    detect-pm.test.ts                  # detectPackageManager unit tests
    template.test.ts                   # template ops against a fixture tree
    cli.test.ts                        # run() end-to-end with --no-install --no-git
    scaffold-integration.test.ts       # gated under vitest.integration.config.ts
```

**Responsibilities (one per file):**
- `bin/index.mjs`: shebang, top-level error handling, exit codes. Delegates everything to `run()`.
- `lib/cli.mjs`: orchestration only. Wires parseArgs → validate → copyTemplate → substituteName → renameDotfiles → spawn install → spawn git → print next-steps. Holds no parsing/detection logic itself.
- `lib/args.mjs`: pure argv → typed options. No I/O.
- `lib/detect-pm.mjs`: pure env-vars → `'npm' | 'pnpm' | 'yarn' | 'bun'`. No I/O.
- `lib/template.mjs`: filesystem ops (`fs.cp`, recursive rename, string replace). I/O confined here.
- `templates/`: pure data, no code logic.

Tests mirror lib structure 1:1.

---

## Task 1: Bootstrap the package

**Files:**
- Create: `packages/create-hono-preact/package.json`
- Create: `packages/create-hono-preact/README.md`
- Create: `packages/create-hono-preact/bin/index.mjs` (stub)
- Create: `packages/create-hono-preact/lib/cli.mjs` (stub)
- Modify: `vitest.config.ts:38-44` — append `packages/create-hono-preact/__tests__/**/*.test.{ts,tsx}` to `test.include`

- [ ] **Step 1: Create the package directory tree**

```bash
mkdir -p packages/create-hono-preact/bin packages/create-hono-preact/lib packages/create-hono-preact/templates/cloudflare/src/pages packages/create-hono-preact/templates/node/src/pages packages/create-hono-preact/__tests__
```

- [ ] **Step 2: Write `packages/create-hono-preact/package.json`**

```json
{
  "name": "create-hono-preact",
  "version": "0.1.0",
  "description": "Scaffold a new hono-preact app.",
  "keywords": ["hono-preact", "create", "scaffold", "cli"],
  "homepage": "https://framework.sbesh.com",
  "bugs": {
    "url": "https://github.com/sbesh91/hono-preact/issues"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/sbesh91/hono-preact.git",
    "directory": "packages/create-hono-preact"
  },
  "license": "MIT",
  "author": "Steven Beshensky",
  "engines": {
    "node": ">=20"
  },
  "type": "module",
  "bin": {
    "create-hono-preact": "./bin/index.mjs"
  },
  "files": [
    "bin",
    "lib",
    "templates",
    "README.md"
  ],
  "dependencies": {
    "picocolors": "^1.1.1"
  }
}
```

- [ ] **Step 3: Write `packages/create-hono-preact/README.md`**

```markdown
# create-hono-preact

Scaffold a new hono-preact app.

```bash
npm create hono-preact my-app
pnpm create hono-preact my-app
yarn create hono-preact my-app
bun create hono-preact my-app
```

## Flags

- `--adapter=<cloudflare|node>` — pick the deployment target (default: `cloudflare`)
- `--no-install` — skip the package-manager install step
- `--no-git` — skip `git init`
- `--help`, `--version`

See [https://framework.sbesh.com/docs](https://framework.sbesh.com/docs) for the framework documentation.
```

- [ ] **Step 4: Write `packages/create-hono-preact/bin/index.mjs` (stub)**

```js
#!/usr/bin/env node
import { run } from '../lib/cli.mjs';

run({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
}).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  }
);
```

Make executable:

```bash
chmod +x packages/create-hono-preact/bin/index.mjs
```

- [ ] **Step 5: Write `packages/create-hono-preact/lib/cli.mjs` (stub)**

```js
export async function run() {
  throw new Error('not yet implemented');
}
```

- [ ] **Step 6: Register the new test path in `vitest.config.ts`**

In `vitest.config.ts`, locate the `test.include` array (around line 38). Add the new pattern:

```ts
test: {
  include: [
    'packages/iso/src/**/__tests__/**/*.test.{ts,tsx}',
    'packages/server/src/**/__tests__/**/*.test.{ts,tsx}',
    'packages/vite/src/**/__tests__/**/*.test.ts',
    'packages/hono-preact/__tests__/**/*.test.{ts,tsx}',
    'packages/create-hono-preact/__tests__/**/*.test.{ts,tsx}',  // <-- new
    'apps/site/src/**/__tests__/**/*.test.{ts,tsx}',
  ],
```

And exclude the integration test from the default pool:

```ts
exclude: [
  ...configDefaults.exclude,
  'packages/vite/src/__tests__/websocket-dev.test.ts',
  'packages/create-hono-preact/__tests__/scaffold-integration.test.ts',  // <-- new
],
```

- [ ] **Step 7: Install the new package via pnpm (wires it into the workspace)**

Run: `pnpm install`
Expected: pnpm picks up the new package (already covered by `packages/*` in `pnpm-workspace.yaml`); installs `picocolors`.

- [ ] **Step 8: Sanity-check vitest still runs**

Run: `pnpm test`
Expected: all existing tests pass; no new tests yet for create-hono-preact.

- [ ] **Step 9: Commit**

```bash
git add packages/create-hono-preact vitest.config.ts pnpm-lock.yaml
git commit -m "feat(create-hono-preact): bootstrap package skeleton (#47)"
```

---

## Task 2: TDD `parseArgs`

**Files:**
- Create: `packages/create-hono-preact/__tests__/args.test.ts`
- Create: `packages/create-hono-preact/lib/args.mjs`

- [ ] **Step 1: Write the failing tests**

Create `packages/create-hono-preact/__tests__/args.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain JS module, no .d.ts
import { parseArgs } from '../lib/args.mjs';

describe('parseArgs', () => {
  it('parses a positional target dir', () => {
    expect(parseArgs(['my-app'])).toEqual({
      kind: 'scaffold',
      targetDir: 'my-app',
      adapter: 'cloudflare',
      install: true,
      git: true,
    });
  });

  it('defaults adapter to cloudflare', () => {
    expect(parseArgs(['my-app']).adapter).toBe('cloudflare');
  });

  it('accepts --adapter=node', () => {
    expect(parseArgs(['my-app', '--adapter=node']).adapter).toBe('node');
  });

  it('accepts --adapter=cloudflare', () => {
    expect(parseArgs(['my-app', '--adapter=cloudflare']).adapter).toBe('cloudflare');
  });

  it('rejects an unknown adapter', () => {
    const result = parseArgs(['my-app', '--adapter=deno']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unknown adapter.*deno/i);
    }
  });

  it('--no-install flips install to false', () => {
    expect(parseArgs(['my-app', '--no-install']).install).toBe(false);
  });

  it('--no-git flips git to false', () => {
    expect(parseArgs(['my-app', '--no-git']).git).toBe(false);
  });

  it('returns kind=help for --help', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('returns kind=help for -h', () => {
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('returns kind=version for --version', () => {
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
  });

  it('returns kind=scaffold with no targetDir when none given', () => {
    expect(parseArgs([])).toEqual({
      kind: 'scaffold',
      targetDir: undefined,
      adapter: 'cloudflare',
      install: true,
      git: true,
    });
  });

  it('flags can appear before the target dir', () => {
    expect(parseArgs(['--adapter=node', '--no-install', 'my-app'])).toEqual({
      kind: 'scaffold',
      targetDir: 'my-app',
      adapter: 'node',
      install: false,
      git: true,
    });
  });

  it('rejects unknown flags with kind=error', () => {
    const result = parseArgs(['my-app', '--unknown']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unknown flag.*--unknown/i);
    }
  });

  it('rejects multiple positional args', () => {
    const result = parseArgs(['my-app', 'extra']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unexpected/i);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/create-hono-preact/__tests__/args.test.ts`
Expected: FAIL with "Failed to resolve import '../lib/args.mjs'" or "parseArgs is not a function".

- [ ] **Step 3: Implement `parseArgs`**

Create `packages/create-hono-preact/lib/args.mjs`:

```js
/**
 * @param {string[]} argv
 * @returns {
 *   { kind: 'help' } |
 *   { kind: 'version' } |
 *   { kind: 'error', message: string } |
 *   { kind: 'scaffold', targetDir: string | undefined, adapter: 'cloudflare' | 'node', install: boolean, git: boolean }
 * }
 */
export function parseArgs(argv) {
  let targetDir;
  let adapter = 'cloudflare';
  let install = true;
  let git = true;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    if (arg === '--version' || arg === '-v') return { kind: 'version' };
    if (arg === '--no-install') {
      install = false;
    } else if (arg === '--no-git') {
      git = false;
    } else if (arg.startsWith('--adapter=')) {
      const value = arg.slice('--adapter='.length);
      if (value !== 'cloudflare' && value !== 'node') {
        return { kind: 'error', message: `unknown adapter: ${value} (expected 'cloudflare' or 'node')` };
      }
      adapter = value;
    } else if (arg.startsWith('-')) {
      return { kind: 'error', message: `unknown flag: ${arg}` };
    } else if (targetDir === undefined) {
      targetDir = arg;
    } else {
      return { kind: 'error', message: `unexpected positional argument: ${arg}` };
    }
  }

  return { kind: 'scaffold', targetDir, adapter, install, git };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/create-hono-preact/__tests__/args.test.ts`
Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-hono-preact/__tests__/args.test.ts packages/create-hono-preact/lib/args.mjs
git commit -m "feat(create-hono-preact): parseArgs with adapter and flag handling"
```

---

## Task 3: TDD `detectPackageManager`

**Files:**
- Create: `packages/create-hono-preact/__tests__/detect-pm.test.ts`
- Create: `packages/create-hono-preact/lib/detect-pm.mjs`

- [ ] **Step 1: Write the failing tests**

Create `packages/create-hono-preact/__tests__/detect-pm.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain JS module
import { detectPackageManager } from '../lib/detect-pm.mjs';

describe('detectPackageManager', () => {
  it('returns npm when user-agent starts with npm/', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'npm/10.2.5 node/v20.10.0 darwin arm64' })).toBe('npm');
  });

  it('returns pnpm when user-agent starts with pnpm/', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'pnpm/10.18.3 npm/? node/v20.10.0 darwin arm64' })).toBe('pnpm');
  });

  it('returns yarn when user-agent starts with yarn/', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'yarn/4.2.2 npm/? node/v20.10.0 darwin arm64' })).toBe('yarn');
  });

  it('returns bun when user-agent starts with bun/', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'bun/1.0.30 npm/? node/v20.10.0 darwin arm64' })).toBe('bun');
  });

  it('defaults to pnpm when env is empty', () => {
    expect(detectPackageManager({})).toBe('pnpm');
  });

  it('defaults to pnpm when user-agent is unrecognised', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'something-weird/1.0' })).toBe('pnpm');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/create-hono-preact/__tests__/detect-pm.test.ts`
Expected: FAIL with import error.

- [ ] **Step 3: Implement `detectPackageManager`**

Create `packages/create-hono-preact/lib/detect-pm.mjs`:

```js
/**
 * Read `npm_config_user_agent` to pick a package manager. Falls back to pnpm.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {'npm' | 'pnpm' | 'yarn' | 'bun'}
 */
export function detectPackageManager(env) {
  const ua = env.npm_config_user_agent ?? '';
  if (ua.startsWith('npm/')) return 'npm';
  if (ua.startsWith('pnpm/')) return 'pnpm';
  if (ua.startsWith('yarn/')) return 'yarn';
  if (ua.startsWith('bun/')) return 'bun';
  return 'pnpm';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/create-hono-preact/__tests__/detect-pm.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-hono-preact/__tests__/detect-pm.test.ts packages/create-hono-preact/lib/detect-pm.mjs
git commit -m "feat(create-hono-preact): detect package manager from npm_config_user_agent"
```

---

## Task 4: TDD template ops (`copyTemplate`, `renameDotfiles`, `substituteName`)

**Files:**
- Create: `packages/create-hono-preact/__tests__/template.test.ts`
- Create: `packages/create-hono-preact/__tests__/fixtures/sample-template/_gitignore`
- Create: `packages/create-hono-preact/__tests__/fixtures/sample-template/package.json`
- Create: `packages/create-hono-preact/__tests__/fixtures/sample-template/src/index.ts`
- Create: `packages/create-hono-preact/lib/template.mjs`

- [ ] **Step 1: Create the fixture tree**

```bash
mkdir -p packages/create-hono-preact/__tests__/fixtures/sample-template/src
```

`packages/create-hono-preact/__tests__/fixtures/sample-template/_gitignore`:

```
node_modules
dist
```

`packages/create-hono-preact/__tests__/fixtures/sample-template/package.json`:

```json
{
  "name": "{{name}}",
  "version": "0.0.0"
}
```

`packages/create-hono-preact/__tests__/fixtures/sample-template/src/index.ts`:

```ts
export const greeting = 'hello {{name}}';
```

- [ ] **Step 2: Write the failing tests**

Create `packages/create-hono-preact/__tests__/template.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain JS module
import { copyTemplate, renameDotfiles, substituteName } from '../lib/template.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..');
const fixture = join(here, 'fixtures', 'sample-template');

let target: string;
beforeEach(() => {
  target = mkdtempSync(join(tmpdir(), 'chp-template-test-'));
});
afterEach(() => {
  rmSync(target, { recursive: true, force: true });
});

describe('copyTemplate', () => {
  it('copies the entire fixture tree into the target dir', async () => {
    await copyTemplate(fixture, target);
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, 'src', 'index.ts'))).toBe(true);
    expect(existsSync(join(target, '_gitignore'))).toBe(true);
  });
});

describe('renameDotfiles', () => {
  it('renames _gitignore to .gitignore', async () => {
    await copyTemplate(fixture, target);
    await renameDotfiles(target);
    expect(existsSync(join(target, '_gitignore'))).toBe(false);
    expect(existsSync(join(target, '.gitignore'))).toBe(true);
  });

  it('is a no-op when no _gitignore present', async () => {
    await renameDotfiles(target);
    expect(existsSync(join(target, '.gitignore'))).toBe(false);
  });
});

describe('substituteName', () => {
  it('replaces {{name}} in package.json', async () => {
    await copyTemplate(fixture, target);
    await substituteName(target, 'my-app');
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-app');
  });

  it('does not touch files without the placeholder', async () => {
    await copyTemplate(fixture, target);
    const before = readFileSync(join(target, 'src', 'index.ts'), 'utf8');
    await substituteName(target, 'my-app');
    const after = readFileSync(join(target, 'src', 'index.ts'), 'utf8');
    // substituteName only touches package.json and wrangler.jsonc, not source files
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test packages/create-hono-preact/__tests__/template.test.ts`
Expected: FAIL with import error.

- [ ] **Step 4: Implement template ops**

Create `packages/create-hono-preact/lib/template.mjs`:

```js
import { cp, rename, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Recursively copy a template directory into the target.
 *
 * @param {string} source absolute path to the template tree
 * @param {string} target absolute path to the destination dir
 */
export async function copyTemplate(source, target) {
  await cp(source, target, { recursive: true });
}

/**
 * Rename underscore-prefixed dotfiles emitted by the template
 * (e.g. `_gitignore` -> `.gitignore`). npm and pnpm strip dotfiles from
 * published tarballs, so the template ships with the underscore name.
 *
 * @param {string} target absolute path to the scaffolded dir
 */
export async function renameDotfiles(target) {
  const map = [['_gitignore', '.gitignore']];
  for (const [from, to] of map) {
    const src = join(target, from);
    try {
      await access(src);
    } catch {
      continue;
    }
    await rename(src, join(target, to));
  }
}

/**
 * Replace `{{name}}` in `package.json` and (if present) `wrangler.jsonc`.
 *
 * @param {string} target absolute path to the scaffolded dir
 * @param {string} name new project name
 */
export async function substituteName(target, name) {
  for (const file of ['package.json', 'wrangler.jsonc']) {
    const path = join(target, file);
    try {
      await access(path);
    } catch {
      continue;
    }
    const original = await readFile(path, 'utf8');
    const updated = original.replaceAll('{{name}}', name);
    if (updated !== original) {
      await writeFile(path, updated);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test packages/create-hono-preact/__tests__/template.test.ts`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/create-hono-preact/__tests__/template.test.ts packages/create-hono-preact/__tests__/fixtures packages/create-hono-preact/lib/template.mjs
git commit -m "feat(create-hono-preact): template copy, dotfile rename, name substitution"
```

---

## Task 5: Node template files

**Files:**
- Create: `packages/create-hono-preact/templates/node/_gitignore`
- Create: `packages/create-hono-preact/templates/node/package.json`
- Create: `packages/create-hono-preact/templates/node/tsconfig.json`
- Create: `packages/create-hono-preact/templates/node/vite.config.ts`
- Create: `packages/create-hono-preact/templates/node/README.md`
- Create: `packages/create-hono-preact/templates/node/src/api.ts`
- Create: `packages/create-hono-preact/templates/node/src/Layout.tsx`
- Create: `packages/create-hono-preact/templates/node/src/routes.ts`
- Create: `packages/create-hono-preact/templates/node/src/pages/home.tsx`
- Create: `packages/create-hono-preact/templates/node/src/pages/home.server.ts`
- Create: `packages/create-hono-preact/templates/node/src/pages/about.tsx`

- [ ] **Step 1: Write `_gitignore`**

```
node_modules
dist
.DS_Store
*.log
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "{{name}}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "start": "node dist/server/server-entry.js"
  },
  "dependencies": {
    "hono": "^4.12.14",
    "hono-preact": "^0.1.0",
    "preact": "^10.29.1",
    "preact-iso": "github:preactjs/preact-iso#v3"
  },
  "devDependencies": {
    "@hono/node-server": "^1.19.14",
    "@preact/preset-vite": "^2.10.5",
    "preact-render-to-string": "^6.6.7",
    "typescript": "^5.6.0",
    "vite": "^8.0.8"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM"],
    "types": []
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import { honoPreact } from 'hono-preact/vite';
import { nodeAdapter } from 'hono-preact/adapter-node';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [honoPreact({ adapter: nodeAdapter() })],
});
```

- [ ] **Step 5: Write `README.md`**

```markdown
# {{name}}

A [hono-preact](https://framework.sbesh.com) app, scaffolded for the Node.js adapter.

## Develop

```bash
pnpm dev
```

## Build

```bash
pnpm build
```

## Start production server

```bash
pnpm start
```

The server listens on `PORT` (default 3000).

## Learn more

- [Quick Start](https://framework.sbesh.com/docs/quick-start)
- [Composing Hono Middleware](https://framework.sbesh.com/docs/hono-middleware)
- [Build & Deploy](https://framework.sbesh.com/docs/deployment)
```

- [ ] **Step 6: Write `src/api.ts`**

```ts
import { Hono } from 'hono';

// Your custom HTTP routes and Hono middleware go here. The framework
// mounts this app ahead of its reserved /__loaders and /__actions paths
// and the SSR catch-all. See https://framework.sbesh.com/docs/hono-middleware
const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));

export default app;
```

- [ ] **Step 7: Write `src/Layout.tsx`**

```tsx
import { ClientScript, Head } from 'hono-preact';
import type { ComponentChildren } from 'preact';

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <Head defaultTitle="{{name}}" />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Write `src/routes.ts`**

```ts
import { defineRoutes } from 'hono-preact';

export default defineRoutes([
  {
    path: '/',
    view: () => import('./pages/home.js'),
    server: () => import('./pages/home.server.js'),
  },
  { path: '/about', view: () => import('./pages/about.js') },
]);
```

- [ ] **Step 9: Write `src/pages/home.tsx`**

```tsx
import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from './home.server.js';

const homeLoader = serverLoaders.default;

const HomePage: FunctionComponent = () => {
  const { message, renderedAt } = homeLoader.useData();
  return (
    <section>
      <h1>Welcome to {{'{{name}}'}}</h1>
      <p>{message}</p>
      <p>
        <small>Rendered at {renderedAt}</small>
      </p>
      <a href="/about">About</a>
    </section>
  );
};
HomePage.displayName = 'HomePage';

const HomeView = homeLoader.View(() => <HomePage />, {
  fallback: <p>Loading...</p>,
});

export default definePage(HomeView, {});
```

Note: the `{{'{{name}}'}}` construct is intentional. JSX evaluates `{{'literal'}}` as `{ 'literal' }` — a string child — so the rendered output preserves the literal `{{name}}` for `substituteName` to find.

- [ ] **Step 10: Write `src/pages/home.server.ts`**

```ts
import { defineLoader } from 'hono-preact';

export const serverLoaders = {
  default: defineLoader(async () => ({
    message: 'Hello from your hono-preact app!',
    renderedAt: new Date().toISOString(),
  })),
};
```

- [ ] **Step 11: Write `src/pages/about.tsx`**

```tsx
import type { FunctionComponent } from 'preact';

const About: FunctionComponent = () => (
  <section>
    <h1>About</h1>
    <p>This is your scaffolded hono-preact app.</p>
    <a href="/">Home</a>
  </section>
);
About.displayName = 'About';

export default About;
```

- [ ] **Step 12: Commit**

```bash
git add packages/create-hono-preact/templates/node
git commit -m "feat(create-hono-preact): Node adapter template"
```

---

## Task 6: Cloudflare template files

**Files:**
- Create: `packages/create-hono-preact/templates/cloudflare/_gitignore`
- Create: `packages/create-hono-preact/templates/cloudflare/package.json`
- Create: `packages/create-hono-preact/templates/cloudflare/tsconfig.json`
- Create: `packages/create-hono-preact/templates/cloudflare/vite.config.ts`
- Create: `packages/create-hono-preact/templates/cloudflare/wrangler.jsonc`
- Create: `packages/create-hono-preact/templates/cloudflare/README.md`
- Create: `packages/create-hono-preact/templates/cloudflare/src/api.ts`
- Create: `packages/create-hono-preact/templates/cloudflare/src/Layout.tsx`
- Create: `packages/create-hono-preact/templates/cloudflare/src/routes.ts`
- Create: `packages/create-hono-preact/templates/cloudflare/src/pages/home.tsx`
- Create: `packages/create-hono-preact/templates/cloudflare/src/pages/home.server.ts`
- Create: `packages/create-hono-preact/templates/cloudflare/src/pages/about.tsx`

- [ ] **Step 1: Write `_gitignore`**

```
node_modules
dist
.wrangler
.DS_Store
*.log
```

- [ ] **Step 2: Write `package.json`**

The `deploy` script intentionally has no `-c <path>` flag. The framework writes the Worker bundle into `dist/<name-with-underscores>/`, and we can't predict that path at template-substitution time. The README explains the underscore rule and tells the user to `cd dist/<name>` (with underscores) before running `wrangler deploy`, or to add their own `-c` flag once they know their project name's underscore form.

```json
{
  "name": "{{name}}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "hono": "^4.12.14",
    "hono-preact": "^0.1.0",
    "preact": "^10.29.1",
    "preact-iso": "github:preactjs/preact-iso#v3"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.37.1",
    "@preact/preset-vite": "^2.10.5",
    "preact-render-to-string": "^6.6.7",
    "typescript": "^5.6.0",
    "vite": "^8.0.8",
    "wrangler": "^4.92.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM"],
    "types": []
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import { honoPreact } from 'hono-preact/vite';
import { cloudflareAdapter } from 'hono-preact/adapter-cloudflare';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [honoPreact({ adapter: cloudflareAdapter() })],
});
```

- [ ] **Step 5: Write `wrangler.jsonc`**

```jsonc
{
  "name": "{{name}}",
  "main": "node_modules/.vite/hono-preact/server-entry.tsx",
  "compatibility_date": "2026-02-22",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist/client"
  }
}
```

- [ ] **Step 6: Write `README.md`**

```markdown
# {{name}}

A [hono-preact](https://framework.sbesh.com) app, scaffolded for Cloudflare Workers.

## Develop

```bash
pnpm dev
```

The Cloudflare adapter runs your worker inside workerd via `@cloudflare/vite-plugin`, so development mirrors production.

## Build

```bash
pnpm build
```

Outputs:
- `dist/client/` — static assets, served from Cloudflare's CDN
- `dist/<name>/` — the Worker bundle (hyphens in `wrangler.jsonc`'s `name` become underscores)

## Deploy

```bash
pnpm build
cd dist/{{name}}     # NOTE: if your project name has hyphens, the dir name has underscores (e.g. "my-app" -> "my_app")
wrangler deploy
```

## Learn more

- [Quick Start](https://framework.sbesh.com/docs/quick-start)
- [Composing Hono Middleware](https://framework.sbesh.com/docs/hono-middleware)
- [Build & Deploy](https://framework.sbesh.com/docs/deployment)
```

- [ ] **Step 7: Write `src/api.ts`**

Identical to the Node template's `src/api.ts`:

```ts
import { Hono } from 'hono';

// Your custom HTTP routes and Hono middleware go here. The framework
// mounts this app ahead of its reserved /__loaders and /__actions paths
// and the SSR catch-all. See https://framework.sbesh.com/docs/hono-middleware
const app = new Hono();

app.get('/healthz', (c) => c.text('ok'));

export default app;
```

- [ ] **Step 8: Write `src/Layout.tsx`**

Identical to the Node template's `src/Layout.tsx`:

```tsx
import { ClientScript, Head } from 'hono-preact';
import type { ComponentChildren } from 'preact';

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <Head defaultTitle="{{name}}" />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Write `src/routes.ts`**

Identical to Node's:

```ts
import { defineRoutes } from 'hono-preact';

export default defineRoutes([
  {
    path: '/',
    view: () => import('./pages/home.js'),
    server: () => import('./pages/home.server.js'),
  },
  { path: '/about', view: () => import('./pages/about.js') },
]);
```

- [ ] **Step 10: Write `src/pages/home.tsx`**

Identical to Node's:

```tsx
import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { serverLoaders } from './home.server.js';

const homeLoader = serverLoaders.default;

const HomePage: FunctionComponent = () => {
  const { message, renderedAt } = homeLoader.useData();
  return (
    <section>
      <h1>Welcome to {{'{{name}}'}}</h1>
      <p>{message}</p>
      <p>
        <small>Rendered at {renderedAt}</small>
      </p>
      <a href="/about">About</a>
    </section>
  );
};
HomePage.displayName = 'HomePage';

const HomeView = homeLoader.View(() => <HomePage />, {
  fallback: <p>Loading...</p>,
});

export default definePage(HomeView, {});
```

- [ ] **Step 11: Write `src/pages/home.server.ts`**

Identical to Node's:

```ts
import { defineLoader } from 'hono-preact';

export const serverLoaders = {
  default: defineLoader(async () => ({
    message: 'Hello from your hono-preact app!',
    renderedAt: new Date().toISOString(),
  })),
};
```

- [ ] **Step 12: Write `src/pages/about.tsx`**

Identical to Node's:

```tsx
import type { FunctionComponent } from 'preact';

const About: FunctionComponent = () => (
  <section>
    <h1>About</h1>
    <p>This is your scaffolded hono-preact app.</p>
    <a href="/">Home</a>
  </section>
);
About.displayName = 'About';

export default About;
```

- [ ] **Step 13: Commit**

```bash
git add packages/create-hono-preact/templates/cloudflare
git commit -m "feat(create-hono-preact): Cloudflare adapter template"
```

---

## Task 7: TDD `run()` core flow (no install, no git, no prompt)

**Files:**
- Create: `packages/create-hono-preact/__tests__/cli.test.ts`
- Modify: `packages/create-hono-preact/lib/cli.mjs`

- [ ] **Step 1: Write the failing tests**

Create `packages/create-hono-preact/__tests__/cli.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- plain JS module
import { run } from '../lib/cli.mjs';

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'chp-cli-test-'));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('run() — node adapter', () => {
  it('scaffolds a new node app with --no-install --no-git', async () => {
    const code = await run({
      argv: ['my-test-app', '--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(code).toBe(0);

    const target = join(workDir, 'my-test-app');
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, '.gitignore'))).toBe(true);
    expect(existsSync(join(target, '_gitignore'))).toBe(false);
    expect(existsSync(join(target, 'vite.config.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'api.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'Layout.tsx'))).toBe(true);
    expect(existsSync(join(target, 'src', 'routes.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'pages', 'home.tsx'))).toBe(true);
    expect(existsSync(join(target, 'src', 'pages', 'home.server.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'pages', 'about.tsx'))).toBe(true);

    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-test-app');

    const layout = readFileSync(join(target, 'src', 'Layout.tsx'), 'utf8');
    // substituteName only touches package.json + wrangler.jsonc;
    // Layout.tsx keeps the literal {{name}} placeholder.
    expect(layout).toContain('{{name}}');
  });
});

describe('run() — cloudflare adapter', () => {
  it('scaffolds a new cloudflare app, including wrangler.jsonc', async () => {
    const code = await run({
      argv: ['my-cf-app', '--adapter=cloudflare', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(code).toBe(0);

    const target = join(workDir, 'my-cf-app');
    expect(existsSync(join(target, 'wrangler.jsonc'))).toBe(true);
    const wrangler = readFileSync(join(target, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"name": "my-cf-app"');
  });

  it('cloudflare is the default adapter', async () => {
    await run({
      argv: ['default-cf', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(existsSync(join(workDir, 'default-cf', 'wrangler.jsonc'))).toBe(true);
  });
});

describe('run() — target dir validation', () => {
  it('refuses a non-empty existing target dir', async () => {
    const target = join(workDir, 'existing');
    const fs = await import('node:fs/promises');
    await fs.mkdir(target);
    await fs.writeFile(join(target, 'README.md'), 'hi');

    const code = await run({
      argv: ['existing', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(code).toBe(1);
  });

  it('accepts an empty existing target dir', async () => {
    const target = join(workDir, 'empty-existing');
    const fs = await import('node:fs/promises');
    await fs.mkdir(target);

    const code = await run({
      argv: ['empty-existing', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
    });
    expect(code).toBe(0);
    expect(existsSync(join(target, 'package.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: FAIL with "not yet implemented".

- [ ] **Step 3: Implement `run()`**

Rewrite `packages/create-hono-preact/lib/cli.mjs`:

```js
import { readdir, mkdir, stat } from 'node:fs/promises';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';
import { detectPackageManager } from './detect-pm.mjs';
import { copyTemplate, renameDotfiles, substituteName } from './template.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templatesRoot = resolve(here, '..', 'templates');

/**
 * @param {{ argv: string[], cwd: string, env: Record<string, string | undefined> }} opts
 * @returns {Promise<number>} exit code (0 on success)
 */
export async function run({ argv, cwd, env }) {
  const parsed = parseArgs(argv);

  if (parsed.kind === 'help') {
    printHelp();
    return 0;
  }
  if (parsed.kind === 'version') {
    console.log('create-hono-preact 0.1.0');
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(parsed.message);
    printHelp();
    return 2;
  }

  let { targetDir, adapter, install, git } = parsed;

  if (!targetDir) {
    console.error('error: target directory is required');
    printHelp();
    return 2;
  }

  const targetPath = resolve(cwd, targetDir);

  // Validate target: refuse if it exists and is non-empty.
  try {
    const entries = await readdir(targetPath);
    if (entries.length > 0) {
      console.error(`error: target directory '${targetDir}' is not empty`);
      return 1;
    }
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      await mkdir(targetPath, { recursive: true });
    } else {
      throw err;
    }
  }

  const sourceTemplate = join(templatesRoot, adapter);
  await copyTemplate(sourceTemplate, targetPath);
  await renameDotfiles(targetPath);
  await substituteName(targetPath, basename(targetPath));

  // Install and git steps land in the next tasks.

  return 0;
}

function printHelp() {
  console.log(`Usage: create-hono-preact <target-dir> [options]

Scaffold a new hono-preact app.

Options:
  --adapter=<cloudflare|node>   pick the deployment target (default: cloudflare)
  --no-install                  skip dependency install
  --no-git                      skip 'git init'
  -h, --help                    show this help
  -v, --version                 show version`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: 5 tests pass (1 node-adapter, 2 cloudflare-adapter, 2 target-validation).

- [ ] **Step 5: Commit**

```bash
git add packages/create-hono-preact/__tests__/cli.test.ts packages/create-hono-preact/lib/cli.mjs
git commit -m "feat(create-hono-preact): run() core flow with adapter selection and target validation"
```

---

## Task 8: TDD `run()` install step with mockable spawn

**Files:**
- Modify: `packages/create-hono-preact/__tests__/cli.test.ts` (append a describe)
- Modify: `packages/create-hono-preact/lib/cli.mjs`

The `spawn` call is the side effect we need to verify. We inject a `spawnFn` option on `run()` so tests substitute a spy. The default in production is `child_process.spawn` with `stdio: 'inherit'`.

- [ ] **Step 1: Append the failing test to `cli.test.ts`**

Append to `packages/create-hono-preact/__tests__/cli.test.ts`:

```ts
describe('run() — install step', () => {
  it('invokes the detected package manager when install is enabled', async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const fakeSpawn = (cmd: string, args: string[], opts: { cwd: string }) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      // Mimic a successful child_process.spawn: return an object with `on`.
      return {
        on(event: string, cb: (code: number) => void) {
          if (event === 'close') queueMicrotask(() => cb(0));
        },
      };
    };

    const code = await run({
      argv: ['installed-app', '--adapter=node', '--no-git'],
      cwd: workDir,
      env: { npm_config_user_agent: 'pnpm/10.18.3 npm/? node/v20 darwin arm64' },
      spawnFn: fakeSpawn,
    });

    expect(code).toBe(0);
    expect(calls.length).toBe(1);
    expect(calls[0].cmd).toBe('pnpm');
    expect(calls[0].args).toEqual(['install']);
    expect(calls[0].cwd).toBe(join(workDir, 'installed-app'));
  });

  it('skips install when --no-install is set', async () => {
    const calls: Array<{ cmd: string }> = [];
    const fakeSpawn = (cmd: string) => {
      calls.push({ cmd });
      return { on: (_e: string, cb: (c: number) => void) => queueMicrotask(() => cb(0)) };
    };

    await run({
      argv: ['skipped-app', '--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: { npm_config_user_agent: 'npm/10.2.5' },
      spawnFn: fakeSpawn,
    });

    expect(calls.length).toBe(0);
  });

  it('returns 1 when install fails', async () => {
    const fakeSpawn = () => ({
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') queueMicrotask(() => cb(1));
      },
    });

    const code = await run({
      argv: ['fail-install', '--adapter=node', '--no-git'],
      cwd: workDir,
      env: { npm_config_user_agent: 'pnpm/10' },
      spawnFn: fakeSpawn,
    });

    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: 3 new tests fail because `run()` doesn't accept `spawnFn` and doesn't invoke spawn yet.

- [ ] **Step 3: Implement the install step**

Update `packages/create-hono-preact/lib/cli.mjs` — extend the `run` signature, add a `runSpawn` helper, and call it after copy/substitute:

```js
import { readdir, mkdir } from 'node:fs/promises';
import { spawn as realSpawn } from 'node:child_process';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';
import { detectPackageManager } from './detect-pm.mjs';
import { copyTemplate, renameDotfiles, substituteName } from './template.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templatesRoot = resolve(here, '..', 'templates');

/**
 * @param {{
 *   argv: string[],
 *   cwd: string,
 *   env: Record<string, string | undefined>,
 *   spawnFn?: typeof realSpawn,
 * }} opts
 * @returns {Promise<number>} exit code (0 on success)
 */
export async function run({ argv, cwd, env, spawnFn = realSpawn }) {
  const parsed = parseArgs(argv);

  if (parsed.kind === 'help') {
    printHelp();
    return 0;
  }
  if (parsed.kind === 'version') {
    console.log('create-hono-preact 0.1.0');
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(parsed.message);
    printHelp();
    return 2;
  }

  let { targetDir, adapter, install, git } = parsed;

  if (!targetDir) {
    console.error('error: target directory is required');
    printHelp();
    return 2;
  }

  const targetPath = resolve(cwd, targetDir);

  try {
    const entries = await readdir(targetPath);
    if (entries.length > 0) {
      console.error(`error: target directory '${targetDir}' is not empty`);
      return 1;
    }
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      await mkdir(targetPath, { recursive: true });
    } else {
      throw err;
    }
  }

  const sourceTemplate = join(templatesRoot, adapter);
  await copyTemplate(sourceTemplate, targetPath);
  await renameDotfiles(targetPath);
  await substituteName(targetPath, basename(targetPath));

  const pm = detectPackageManager(env);

  if (install) {
    const installExit = await runChild(spawnFn, pm, ['install'], targetPath);
    if (installExit !== 0) return 1;
  }

  // git step lands in the next task.

  return 0;
}

/**
 * @param {typeof realSpawn} spawnFn
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<number>}
 */
function runChild(spawnFn, cmd, args, cwd) {
  return new Promise((res) => {
    const child = spawnFn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('close', (code) => res(code ?? 0));
  });
}

function printHelp() {
  console.log(`Usage: create-hono-preact <target-dir> [options]

Scaffold a new hono-preact app.

Options:
  --adapter=<cloudflare|node>   pick the deployment target (default: cloudflare)
  --no-install                  skip dependency install
  --no-git                      skip 'git init'
  -h, --help                    show this help
  -v, --version                 show version`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: all tests pass (8 total now: 5 from Task 7 + 3 from Task 8).

- [ ] **Step 5: Commit**

```bash
git add packages/create-hono-preact/__tests__/cli.test.ts packages/create-hono-preact/lib/cli.mjs
git commit -m "feat(create-hono-preact): run package-manager install after scaffold"
```

---

## Task 9: TDD `run()` git init step

**Files:**
- Modify: `packages/create-hono-preact/__tests__/cli.test.ts` (append a describe)
- Modify: `packages/create-hono-preact/lib/cli.mjs`

- [ ] **Step 1: Append the failing test**

Append to `packages/create-hono-preact/__tests__/cli.test.ts`:

```ts
describe('run() — git step', () => {
  it('invokes git init when git is enabled', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const fakeSpawn = (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return { on: (e: string, cb: (c: number) => void) => { if (e === 'close') queueMicrotask(() => cb(0)); } };
    };

    await run({
      argv: ['git-app', '--adapter=node', '--no-install'],
      cwd: workDir,
      env: {},
      spawnFn: fakeSpawn,
    });

    const gitCall = calls.find((c) => c.cmd === 'git');
    expect(gitCall).toBeTruthy();
    expect(gitCall?.args).toEqual(['init']);
  });

  it('skips git init when --no-git is set', async () => {
    const calls: Array<{ cmd: string }> = [];
    const fakeSpawn = (cmd: string) => {
      calls.push({ cmd });
      return { on: (e: string, cb: (c: number) => void) => { if (e === 'close') queueMicrotask(() => cb(0)); } };
    };

    await run({
      argv: ['no-git-app', '--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
      spawnFn: fakeSpawn,
    });

    expect(calls.find((c) => c.cmd === 'git')).toBeUndefined();
  });

  it('warns but does not abort when git init fails (git may be absent)', async () => {
    const fakeSpawn = (cmd: string) => {
      if (cmd === 'git') {
        return { on: (e: string, cb: (c: number) => void) => { if (e === 'close') queueMicrotask(() => cb(1)); } };
      }
      return { on: (e: string, cb: (c: number) => void) => { if (e === 'close') queueMicrotask(() => cb(0)); } };
    };

    const code = await run({
      argv: ['git-fail-app', '--adapter=node', '--no-install'],
      cwd: workDir,
      env: {},
      spawnFn: fakeSpawn,
    });

    expect(code).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: 3 new tests fail (git not invoked).

- [ ] **Step 3: Implement the git step**

In `packages/create-hono-preact/lib/cli.mjs`, in `run()` after the install block (and before `return 0;`), add:

```js
  if (git) {
    const gitExit = await runChild(spawnFn, 'git', ['init'], targetPath);
    if (gitExit !== 0) {
      console.warn('warning: git init failed (is git installed?); continuing without git');
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-hono-preact/__tests__/cli.test.ts packages/create-hono-preact/lib/cli.mjs
git commit -m "feat(create-hono-preact): run git init after install (warning on failure)"
```

---

## Task 10: TDD prompt path (when target dir is omitted)

**Files:**
- Modify: `packages/create-hono-preact/__tests__/cli.test.ts`
- Modify: `packages/create-hono-preact/lib/cli.mjs`

We let `run()` accept an injectable `prompt` callback. Default uses `node:readline`. Tests pass a stub.

- [ ] **Step 1: Append the failing test**

Append to `packages/create-hono-preact/__tests__/cli.test.ts`:

```ts
describe('run() — prompt for target dir', () => {
  it('prompts when target dir is missing and uses the answer', async () => {
    const calls: string[] = [];
    const fakeSpawn = () => ({ on: (e: string, cb: (c: number) => void) => { if (e === 'close') queueMicrotask(() => cb(0)); } });
    const fakePrompt = async (msg: string) => {
      calls.push(msg);
      return 'prompted-app';
    };

    const code = await run({
      argv: ['--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
      spawnFn: fakeSpawn,
      prompt: fakePrompt,
    });

    expect(code).toBe(0);
    expect(calls.length).toBe(1);
    expect(calls[0].toLowerCase()).toContain('project');
    expect(existsSync(join(workDir, 'prompted-app', 'package.json'))).toBe(true);
  });

  it('returns 1 when the user provides an empty answer', async () => {
    const fakePrompt = async () => '';
    const code = await run({
      argv: ['--adapter=node', '--no-install', '--no-git'],
      cwd: workDir,
      env: {},
      prompt: fakePrompt,
    });
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: 2 new tests fail — current code prints "target directory is required" and returns 2, never prompts.

- [ ] **Step 3: Implement the prompt path**

In `packages/create-hono-preact/lib/cli.mjs`, replace the early-return block that handles the missing-target case:

Before:
```js
  if (!targetDir) {
    console.error('error: target directory is required');
    printHelp();
    return 2;
  }
```

After:
```js
  if (!targetDir) {
    const answer = (await prompt('Project directory name: ')).trim();
    if (!answer) {
      console.error('error: a project directory name is required');
      return 1;
    }
    targetDir = answer;
  }
```

And extend the function signature:

```js
export async function run({ argv, cwd, env, spawnFn = realSpawn, prompt = defaultPrompt }) {
```

Add the default `defaultPrompt` helper at the bottom of the module:

```js
import readline from 'node:readline/promises';

/**
 * @param {string} message
 * @returns {Promise<string>}
 */
async function defaultPrompt(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}
```

(Move the `import readline ...` to the top of the file with the other imports.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: all 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-hono-preact/__tests__/cli.test.ts packages/create-hono-preact/lib/cli.mjs
git commit -m "feat(create-hono-preact): prompt for project name when omitted"
```

---

## Task 11: TDD help, version, and next-steps output

**Files:**
- Modify: `packages/create-hono-preact/__tests__/cli.test.ts`
- Modify: `packages/create-hono-preact/lib/cli.mjs`

- [ ] **Step 1: Append the failing tests**

Append to `packages/create-hono-preact/__tests__/cli.test.ts`:

```ts
describe('run() — help and version', () => {
  it('--help returns 0 and prints usage', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      const code = await run({ argv: ['--help'], cwd: workDir, env: {} });
      expect(code).toBe(0);
      expect(lines.join('\n').toLowerCase()).toContain('usage');
    } finally {
      console.log = originalLog;
    }
  });

  it('--version returns 0 and prints the version', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      const code = await run({ argv: ['--version'], cwd: workDir, env: {} });
      expect(code).toBe(0);
      expect(lines.join(' ')).toMatch(/create-hono-preact\s+\d+\.\d+\.\d+/);
    } finally {
      console.log = originalLog;
    }
  });

  it('unknown flag returns 2', async () => {
    const code = await run({ argv: ['--bogus'], cwd: workDir, env: {} });
    expect(code).toBe(2);
  });
});

describe('run() — next-steps output', () => {
  it('prints next steps after a successful scaffold', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      const fakeSpawn = () => ({ on: (e: string, cb: (c: number) => void) => { if (e === 'close') queueMicrotask(() => cb(0)); } });
      await run({
        argv: ['next-app', '--adapter=node', '--no-install', '--no-git'],
        cwd: workDir,
        env: { npm_config_user_agent: 'pnpm/10' },
        spawnFn: fakeSpawn,
      });
      const out = lines.join('\n');
      expect(out).toMatch(/next steps/i);
      expect(out).toContain('cd next-app');
      expect(out).toMatch(/pnpm/);
      expect(out).toContain('dev');
    } finally {
      console.log = originalLog;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: next-steps test fails because `run()` doesn't print anything after scaffold. Help/version/unknown-flag should already pass from Task 7.

- [ ] **Step 3: Implement next-steps output**

In `packages/create-hono-preact/lib/cli.mjs`, before the final `return 0;`, add:

```js
  printNextSteps(targetDir, pm, install);
  return 0;
```

Add the helper near the bottom of the file (above `defaultPrompt`):

```js
import pc from 'picocolors';

/**
 * @param {string} targetDir
 * @param {string} pm
 * @param {boolean} installed
 */
function printNextSteps(targetDir, pm, installed) {
  const dev = pm === 'npm' ? 'npm run dev' : `${pm} dev`;
  console.log('');
  console.log(pc.green(pc.bold('Done!')) + ' Next steps:');
  console.log('');
  console.log(`  cd ${targetDir}`);
  if (!installed) {
    const installCmd = pm === 'npm' ? 'npm install' : `${pm} install`;
    console.log(`  ${installCmd}`);
  }
  console.log(`  ${dev}`);
  console.log('');
}
```

(Move the `import pc from 'picocolors';` to the top with the other imports.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/create-hono-preact/__tests__/cli.test.ts`
Expected: all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/create-hono-preact/__tests__/cli.test.ts packages/create-hono-preact/lib/cli.mjs
git commit -m "feat(create-hono-preact): print next-steps with detected package manager"
```

---

## Task 12: Smoke-test the real bin

**Files:** none (manual verification only)

- [ ] **Step 1: Run the CLI directly into a temp dir**

```bash
TEMP=$(mktemp -d)
node packages/create-hono-preact/bin/index.mjs smoke-app --adapter=node --no-install --no-git
ls smoke-app
cat smoke-app/package.json | head -5
rm -rf smoke-app
```

Expected: `smoke-app/` contains `package.json`, `.gitignore`, `vite.config.ts`, `src/`. `package.json`'s `name` is `smoke-app`. No `_gitignore` left.

- [ ] **Step 2: Run with --help**

```bash
node packages/create-hono-preact/bin/index.mjs --help
```

Expected: usage text printed; exit 0.

- [ ] **Step 3: Run with --version**

```bash
node packages/create-hono-preact/bin/index.mjs --version
```

Expected: `create-hono-preact 0.1.0`; exit 0.

- [ ] **Step 4: Run with no args (interactive)**

```bash
# Pipe a name into stdin so it doesn't hang the test.
echo "interactive-app" | node packages/create-hono-preact/bin/index.mjs --adapter=node --no-install --no-git
ls interactive-app
rm -rf interactive-app
```

Expected: prompt accepts the piped answer; `interactive-app/` is created.

No commit; this task validates the bin against the real Node environment without modifying files.

---

## Task 13: Integration test (scaffold + install + build) per adapter

**Files:**
- Create: `packages/create-hono-preact/__tests__/scaffold-integration.test.ts`
- Modify: `vitest.integration.config.ts` — append the new integration test to `include`

The integration test exercises the full pipeline. To avoid depending on the published `hono-preact` package, it packs the local umbrella, rewrites the scaffolded `package.json` to point `hono-preact` at the tarball, then runs install and build.

- [ ] **Step 1: Add the integration test to `vitest.integration.config.ts`**

Update `vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/vite/src/__tests__/websocket-dev.test.ts',
      'packages/create-hono-preact/__tests__/scaffold-integration.test.ts',
    ],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
```

Note: the testTimeout bumps to 3 minutes because a real `pnpm install` of Vite + Preact in a fresh dir can take 60-120 seconds on cold caches.

- [ ] **Step 2: Write the integration test**

Create `packages/create-hono-preact/__tests__/scaffold-integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain JS module
import { run } from '../lib/cli.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

let workDir: string;
let tarballPath: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'chp-integration-'));

  // Build the umbrella, then pack it. The integration test exercises the
  // published-shape artifact, not the workspace source.
  execFileSync('pnpm', ['--filter', '@hono-preact/iso', '--filter', '@hono-preact/server', '--filter', '@hono-preact/vite', '--filter', 'hono-preact', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  const packDir = join(workDir, 'tarballs');
  execFileSync('pnpm', ['pack', '--filter', 'hono-preact', '--pack-destination', packDir], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  // Locate the produced tarball (pnpm pack writes hono-preact-<version>.tgz).
  const entries = readdirSync(packDir);
  const tgz = entries.find((f) => f.startsWith('hono-preact-') && f.endsWith('.tgz'));
  if (!tgz) throw new Error('failed to locate packed hono-preact tarball');
  tarballPath = join(packDir, tgz);
}, 180_000);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function scaffold(name: string, adapter: 'cloudflare' | 'node'): Promise<string> {
  const code = await run({
    argv: [name, `--adapter=${adapter}`, '--no-install', '--no-git'],
    cwd: workDir,
    env: {},
  });
  if (code !== 0) throw new Error(`scaffold failed with code ${code}`);

  const target = join(workDir, name);

  // Point hono-preact at the local tarball so we don't depend on the registry.
  const pkgPath = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies['hono-preact'] = `file:${tarballPath}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  return target;
}

describe('scaffold + install + build — node adapter', () => {
  it('produces a buildable Node app', async () => {
    const target = await scaffold('integration-node', 'node');

    execFileSync('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], {
      cwd: target,
      stdio: 'inherit',
    });

    execFileSync('pnpm', ['build'], { cwd: target, stdio: 'inherit' });

    expect(existsSync(join(target, 'dist', 'client'))).toBe(true);
    expect(existsSync(join(target, 'dist', 'server', 'server-entry.js'))).toBe(true);
  }, 180_000);
});

describe('scaffold + install + build — cloudflare adapter', () => {
  it('produces a buildable Cloudflare app', async () => {
    const target = await scaffold('integration-cf', 'cloudflare');

    execFileSync('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], {
      cwd: target,
      stdio: 'inherit',
    });

    execFileSync('pnpm', ['build'], { cwd: target, stdio: 'inherit' });

    expect(existsSync(join(target, 'dist', 'client'))).toBe(true);
    // Worker output dir: name with hyphens -> underscores ("integration-cf" -> "integration_cf").
    expect(existsSync(join(target, 'dist', 'integration_cf'))).toBe(true);
    expect(existsSync(join(target, 'dist', 'integration_cf', 'index.js'))).toBe(true);
  }, 180_000);
});
```

- [ ] **Step 3: Run the integration suite locally**

Run: `pnpm test:integration`
Expected: both new tests pass plus the existing websocket-dev tests. Each scaffold + install + build will take 30-90 seconds; total runtime under 4 minutes.

If the test fails because the umbrella build pulled in dist artifacts that are out of date, run `pnpm build` at the repo root first, then re-run.

- [ ] **Step 4: Commit**

```bash
git add packages/create-hono-preact/__tests__/scaffold-integration.test.ts vitest.integration.config.ts
git commit -m "test(create-hono-preact): integration scaffold+install+build per adapter"
```

---

## Task 14: Cross-check the docs reference the CLI

**Files:**
- Modify: `apps/site/src/pages/docs/quick-start.mdx`

The current quick-start says "Clone the starter and install dependencies" with a placeholder repo URL. Replace that with `npm create hono-preact` once the CLI exists.

- [ ] **Step 1: Update the prerequisites section**

Open `apps/site/src/pages/docs/quick-start.mdx`. Replace the prerequisites block:

Before:
```markdown
## Prerequisites

Clone the starter and install dependencies:

```bash
git clone <repo-url> my-app
cd my-app
pnpm install
```
```

After:
```markdown
## Prerequisites

Scaffold a new app:

```bash
pnpm create hono-preact my-app
cd my-app
```

The scaffold runs `pnpm install` for you. Pass `--adapter=node` if you're targeting Node.js instead of Cloudflare Workers; see [Build & Deploy](./deployment) for the deployment side.
```

- [ ] **Step 2: Run prettier on the doc**

Run: `pnpm exec prettier --write apps/site/src/pages/docs/quick-start.mdx`
Expected: file may or may not be reformatted; either way exits 0.

- [ ] **Step 3: Run the docs tests**

Run: `pnpm test apps/site/src/pages/docs/__tests__/`
Expected: 5 tests pass (unchanged).

- [ ] **Step 4: Build the docs site**

Run: `pnpm --filter site build`
Expected: build succeeds, exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/docs/quick-start.mdx
git commit -m "docs(site): switch quick-start prerequisites to create-hono-preact"
```

---

## Task 15: Final verification + PR-ready summary

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass, including the new args / detect-pm / template / cli tests.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0. The `create-hono-preact` package has no TS source so the per-package `tsc --noEmit` either skips it (no tsconfig in the package) or runs harmlessly. If `tsc` errors on the new package because no tsconfig exists, skip; the test files import the JS modules via `// @ts-expect-error` annotations.

- [ ] **Step 3: Run prettier check**

Run: `pnpm format:check`
Expected: no files need formatting. If failures, run `pnpm format` and amend the commit on the relevant task.

- [ ] **Step 4: Quick file inventory**

Run: `ls -1 packages/create-hono-preact/ packages/create-hono-preact/templates/node/ packages/create-hono-preact/templates/cloudflare/`
Expected output matches the file structure section at the top of this plan.

- [ ] **Step 5: Manually run the integration suite**

Run: `pnpm test:integration`
Expected: all integration tests pass.

No commit. This is the green-light gate for opening a PR.

---

## Self-Review

**Spec coverage check** (each spec section → which tasks):

| Spec section                  | Implementing task(s)             |
| ----------------------------- | -------------------------------- |
| CLI surface (args, flags)     | Task 2 (parseArgs), Task 11 (help/version) |
| Runtime flow steps 1–9        | Tasks 7–11                       |
| Template content (shared)     | Tasks 5, 6                       |
| Cloudflare-specific files     | Task 6                           |
| Node-specific files           | Task 5                           |
| Version pinning rule          | Tasks 5, 6 `package.json` deps   |
| Package layout                | Tasks 1, 5, 6                    |
| `packages/create-hono-preact/package.json` contract | Task 1 |
| Implementation shape (plain JS ESM, no build) | Tasks 1, 3, 4, 7–11 |
| Maintenance — default pool unit test  | Tasks 2, 3, 4, 7–11      |
| Maintenance — integration pool test   | Task 13                  |
| Publishing                    | Out of scope for code; documented in spec, no code change needed |
| Out-of-scope items            | Not implemented (correctly)      |

No gaps.

**Placeholder scan:** no "TBD", "TODO", "fill in", "similar to". Every step has the actual code or command.

**Type/name consistency:** `parseArgs` returns the same shape across Task 2's definition and Task 7's consumption. `run({ argv, cwd, env, spawnFn, prompt })` parameter list is stable from Task 7 → 8 → 9 → 10 → 11. `copyTemplate`, `renameDotfiles`, `substituteName` names match between Task 4 and Task 7.

**Ambiguity check:** the `{{name}}` placeholder in `src/Layout.tsx` and `src/pages/home.tsx` is preserved (substituteName only touches `package.json` and `wrangler.jsonc`), so users see `{{name}}` in their UI until they edit it. This is intentional and noted in the test ("Layout.tsx keeps the literal `{{name}}` placeholder"). Acceptable for v1 (the title placeholder is a discoverable "edit me" marker); a follow-up could extend substituteName to source files if user feedback requests it.
