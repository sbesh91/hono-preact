# Shared Contract Constants (PR 3 of Section A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared constants module for the cross-package wire-contract literals (`/__loaders`, `static/client.js`, the virtual client id and its dev URL, `__moduleKey`, `__module`, `__action`), so cross-package agreement is structural instead of matching strings.

**Architecture:** New `packages/iso/src/internal/contract.ts`, exported from the iso internal barrel. iso and server consumers import it directly; the vite package gains a `@hono-preact/iso` workspace dependency and interpolates the constants into its codegen template strings (generated output stays self-contained). The umbrella's `consolidate.mjs` already rewrites `@hono-preact/iso/internal` specifiers to relative paths inside `hono-preact/dist`, so the new vite-to-iso import survives consolidation unchanged.

**Tech Stack:** TypeScript, vitest. Vitest config is repo-root-level: run tests FROM THE REPO ROOT (e.g. `pnpm exec vitest run packages/iso/src/__tests__/contract.test.ts`); running inside a package dir finds nothing.

**Spec:** `docs/superpowers/specs/2026-06-10-semantics-consolidation-design.md` (PR 3 section)

**Branch:** `feat/contract-constants`

**Three deviations from the spec's wording, decided during planning:**
1. **The generated server-entry path stays in vite.** It is already single-sourced as `GENERATED_ENTRY_WRAPPER_RELATIVE` in `packages/vite/src/server-entry.ts:227-229`, and it is a vite build-time concept; moving it to iso would be a worse home. The spec's real requirement (the scaffolded `wrangler.jsonc` cannot drift from it) is met by a parity test in packages/vite that reads the template file across the monorepo.
2. **`__moduleKey`/`__module`/`__action` keep literal syntax in typed positions.** TypeScript property declarations (`ActionStub.__module`) and dotted reads (`mod.__moduleKey`) cannot use a runtime constant without bracket-access contortions. The constants cover every VALUE position: FormData keys, `fd.get` calls, property-defining strings, and codegen template strings. The typed positions are pinned against the constants by the existing tests (a codegen string and a typed read that disagree fail the action/loader suites).
3. **`/__actions` stays a literal** in vite's `RESERVED_PATHS`. It appears in exactly one package and is slated for removal by Section D (the dead reservation); promoting it to a shared constant would cement what we plan to delete.

---

### Task 1: contract module in iso internal

**Files:**
- Create: `packages/iso/src/internal/contract.ts`
- Modify: `packages/iso/src/internal.ts` (barrel export)
- Test: `packages/iso/src/__tests__/contract.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `packages/iso/src/__tests__/contract.test.ts`. The exact-value assertions are deliberate: every constant is a wire contract, so an edit to any value must fail loudly here (changing one is a breaking change, not a refactor):

```ts
import { describe, expect, it } from 'vitest';
import {
  LOADERS_RPC_PATH,
  CLIENT_ENTRY_FILE,
  CLIENT_ENTRY_URL,
  VIRTUAL_CLIENT_ID,
  VIRTUAL_CLIENT_DEV_URL,
  MODULE_KEY_EXPORT,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
} from '../internal/contract.js';

describe('wire-contract constants', () => {
  it('pins the exact wire values (changing any is a breaking change)', () => {
    expect(LOADERS_RPC_PATH).toBe('/__loaders');
    expect(CLIENT_ENTRY_FILE).toBe('static/client.js');
    expect(VIRTUAL_CLIENT_ID).toBe('virtual:hono-preact/client');
    expect(MODULE_KEY_EXPORT).toBe('__moduleKey');
    expect(FORM_MODULE_FIELD).toBe('__module');
    expect(FORM_ACTION_FIELD).toBe('__action');
  });

  it('derives the URL forms from their base constants', () => {
    expect(CLIENT_ENTRY_URL).toBe(`/${CLIENT_ENTRY_FILE}`);
    expect(VIRTUAL_CLIENT_DEV_URL).toBe(`/@id/__x00__${VIRTUAL_CLIENT_ID}`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/iso/src/__tests__/contract.test.ts`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Create the module**

Create `packages/iso/src/internal/contract.ts`:

```ts
// Cross-package wire-contract constants. Each constant documents every
// consumer. Standing rule (primitives review, Section F): when a new
// feature needs cross-package agreement on a path, field name, or
// generated id, the value starts life here, not as matching string
// literals. Typed property positions (e.g. `ActionStub.__module`,
// `mod.__moduleKey` reads) keep literal syntax; these constants own every
// value position (FormData keys, fetch URLs, codegen template strings).

/**
 * RPC endpoint for client loader fetches. Consumers: iso
 * `internal/loader-fetch.ts` (the POST), vite `server-entry.ts` (the
 * generated route registration and the reserved-path validation). The
 * generated server entry mounts `loadersHandler` here.
 */
export const LOADERS_RPC_PATH = '/__loaders';

/**
 * Client bundle entry name and its URL form. Consumers: vite
 * `hono-preact.ts` (rollup `entryFileNames`), iso `client-script.tsx`
 * (the production script src). Must stay stable: it is the URL the SSR
 * layer references.
 */
export const CLIENT_ENTRY_FILE = 'static/client.js';
export const CLIENT_ENTRY_URL = `/${CLIENT_ENTRY_FILE}`;

/**
 * Virtual client-entry module id and its Vite dev-server URL. Consumers:
 * vite `client-entry.ts` (resolveId), iso `client-script.tsx` (the dev
 * script src). The URL form encodes Vite's `/@id/` route plus the
 * `__x00__` escape of the `\0` resolved-id prefix.
 */
export const VIRTUAL_CLIENT_ID = 'virtual:hono-preact/client';
export const VIRTUAL_CLIENT_DEV_URL = `/@id/__x00__${VIRTUAL_CLIENT_ID}`;

/**
 * Name of the module-key export the vite plugins generate into `.server.*`
 * modules and thread into loader/action stubs. Consumers: vite
 * `module-key-plugin.ts` and `server-only.ts` (codegen). iso and server
 * read it as a typed property (`mod.__moduleKey`); the literal there is
 * the same contract, kept in property syntax.
 */
export const MODULE_KEY_EXPORT = '__moduleKey';

/**
 * Form field names carrying the action identity in POSTs. Consumers: iso
 * `form.tsx` (FormData set/skip, hidden inputs) and `action.ts` (stub
 * property definition), server `page-action-handler.ts` (form reads and
 * payload skip), vite `server-only.ts` (generated action stubs).
 */
export const FORM_MODULE_FIELD = '__module';
export const FORM_ACTION_FIELD = '__action';
```

In `packages/iso/src/internal.ts`, add to Section 1 (the advanced/escape-hatch section, near the other plain-module exports), with a one-line comment:

```ts
// Cross-package wire-contract constants (paths, field names, generated ids).
export {
  LOADERS_RPC_PATH,
  CLIENT_ENTRY_FILE,
  CLIENT_ENTRY_URL,
  VIRTUAL_CLIENT_ID,
  VIRTUAL_CLIENT_DEV_URL,
  MODULE_KEY_EXPORT,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
} from './internal/contract.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/iso/src/__tests__/contract.test.ts packages/iso/src/__tests__/internal.test.ts`
Expected: PASS (contract 2 tests; if internal.test.ts asserts an exact barrel list, add the eight names there).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/contract.ts packages/iso/src/internal.ts packages/iso/src/__tests__/contract.test.ts
git commit -m "feat(iso): add the cross-package wire-contract constants module

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Add internal.test.ts to the list if it needed the new names.)

---

### Task 2: iso consumers onto the contract

**Files:**
- Modify: `packages/iso/src/internal/loader-fetch.ts:31`
- Modify: `packages/iso/src/client-script.tsx:4-6`
- Modify: `packages/iso/src/form.tsx` (lines 43, 82-83, and the two hidden-input `name` attributes)
- Modify: `packages/iso/src/action.ts` (the `attach('__module', ...)` / `attach('__action', ...)` value-position strings around lines 113-114)
- Test: existing iso suites (staying green is the check; the values are unchanged so no assertion changes)

- [ ] **Step 1: Rewire loader-fetch**

In `packages/iso/src/internal/loader-fetch.ts`, add `import { LOADERS_RPC_PATH } from './contract.js';` and change the fetch call:

```ts
  const res = await fetch(LOADERS_RPC_PATH, {
```

(The rest of the call stays as-is.)

- [ ] **Step 2: Rewire client-script**

Replace the body of `packages/iso/src/client-script.tsx`'s src selection:

```tsx
import type { VNode } from 'preact';
import {
  CLIENT_ENTRY_URL,
  VIRTUAL_CLIENT_DEV_URL,
} from './internal/contract.js';

export function ClientScript(): VNode {
  const src = import.meta.env.PROD ? CLIENT_ENTRY_URL : VIRTUAL_CLIENT_DEV_URL;
```

(The comment block and the returned `<script>` element stay unchanged.)

- [ ] **Step 3: Rewire form.tsx value positions**

Add `import { FORM_MODULE_FIELD, FORM_ACTION_FIELD } from './internal/contract.js';` and replace exactly these value positions (the `action.__module` dotted reads at lines 61-62 stay):

- Line 43: `if (key === FORM_MODULE_FIELD || key === FORM_ACTION_FIELD) continue;`
- Lines 82-83: `fd.set(FORM_MODULE_FIELD, moduleKey); fd.set(FORM_ACTION_FIELD, actionName);`
- The hidden inputs: `<input type="hidden" name={FORM_MODULE_FIELD} value={moduleKey} />` and `<input type="hidden" name={FORM_ACTION_FIELD} value={actionName} />`

- [ ] **Step 4: Rewire action.ts value positions**

Add `import { FORM_MODULE_FIELD, FORM_ACTION_FIELD } from './internal/contract.js';` and replace the two attachment lines at action.ts:113-114:

```ts
  if (opts?.__module !== undefined) attach(FORM_MODULE_FIELD, opts.__module);
  if (opts?.__action !== undefined) attach(FORM_ACTION_FIELD, opts.__action);
```

(The `opts?.__module` dotted reads stay; only the string key passed to `attach` changes.) Then run `rg -n "'__module'|'__action'|\"__module\"|\"__action\"" packages/iso/src --glob '!__tests__'` and convert any remaining value-position hits the same way; typed property declarations and dotted reads are NOT hits for this grep and stay as they are.

- [ ] **Step 5: Run the iso suite**

Run: `pnpm exec vitest run packages/iso/src`
Expected: PASS, same count as before this task (the constants carry identical values; in particular `client-script.test.tsx`'s literal URL assertions still pass).

- [ ] **Step 6: Format and commit**

`pnpm format`; `git status` shows only the four files. Then:

```bash
git add packages/iso/src/internal/loader-fetch.ts packages/iso/src/client-script.tsx packages/iso/src/form.tsx packages/iso/src/action.ts
git commit -m "refactor(iso): consume the wire-contract constants

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: server consumer onto the contract

**Files:**
- Modify: `packages/server/src/page-action-handler.ts:148-159`
- Test: existing server suites (staying green is the check)

- [ ] **Step 1: Rebuild iso dist**

The server package resolves `@hono-preact/iso/internal` through `dist/`:

```bash
pnpm --filter '@hono-preact/iso' build
```

- [ ] **Step 2: Rewire the form reads**

In `packages/server/src/page-action-handler.ts`, extend the existing `@hono-preact/iso/internal` import with `FORM_MODULE_FIELD, FORM_ACTION_FIELD`, then replace the value positions around lines 148-159:

```ts
    const m = fd.get(FORM_MODULE_FIELD);
    const a = fd.get(FORM_ACTION_FIELD);
```

the error message:

```ts
        error: `Form data must include ${FORM_MODULE_FIELD} and ${FORM_ACTION_FIELD} fields`,
```

and the payload skip:

```ts
      if (key === FORM_MODULE_FIELD || key === FORM_ACTION_FIELD) continue;
```

- [ ] **Step 3: Run the server suite, typecheck, format, commit**

`pnpm exec vitest run packages/server/src` (expect 165 passing, unchanged), `pnpm --filter '@hono-preact/server' exec tsc --noEmit`, `pnpm format`. Then:

```bash
git add packages/server/src/page-action-handler.ts
git commit -m "refactor(server): consume the form-field contract constants

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: vite consumers onto the contract + template parity test

**Files:**
- Modify: `packages/vite/package.json` (add dependency)
- Modify: `packages/vite/src/server-entry.ts:61,95`
- Modify: `packages/vite/src/hono-preact.ts:82` (entryFileNames)
- Modify: `packages/vite/src/client-entry.ts:4`
- Modify: `packages/vite/src/module-key-plugin.ts:35,39,84,99`
- Modify: `packages/vite/src/server-only.ts:235,270`
- Test: `packages/vite/src/__tests__/template-parity.test.ts` (new) + existing vite suites

- [ ] **Step 1: Add the dependency**

In `packages/vite/package.json`, add to `dependencies`:

```json
    "@hono-preact/iso": "workspace:*",
```

Then `pnpm install` from the worktree root (updates the lockfile; commit the lockfile change with this task).

- [ ] **Step 2: Write the failing template-parity test**

Create `packages/vite/src/__tests__/template-parity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED_ENTRY_WRAPPER_RELATIVE } from '../server-entry.js';

const here = resolve(fileURLToPath(import.meta.url), '..');

describe('scaffolder template parity', () => {
  it("cloudflare wrangler.jsonc 'main' points at the generated entry wrapper", () => {
    // The scaffolded template cannot import this constant, so this test is
    // the drift guard between the plugin's generated-entry path and the
    // wrangler config the scaffolder ships.
    const wranglerPath = resolve(
      here,
      '../../../create-hono-preact/templates/cloudflare/wrangler.jsonc'
    );
    const raw = readFileSync(wranglerPath, 'utf8');
    const main = /"main"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
    expect(main).toBe(GENERATED_ENTRY_WRAPPER_RELATIVE);
  });
});
```

Run: `pnpm exec vitest run packages/vite/src/__tests__/template-parity.test.ts`
Expected: PASS already (the values agree today); this test exists to FAIL when either side drifts. Verify it runs and passes, then deliberately confirm it is wired to the real file (temporarily typo the regex if unsure, watch it fail, revert).

- [ ] **Step 3: Rewire the vite sources**

All five files add (or extend) the import:

```ts
import { LOADERS_RPC_PATH } from '@hono-preact/iso/internal';
```

(each file imports only the constants it uses).

`packages/vite/src/server-entry.ts`:
- Line 61 (codegen template string): `` `  .post('${LOADERS_RPC_PATH}', loadersHandler(serverModules, { dev, appConfig, resolvePageUse: pageUseResolvers.byPath }))\n` ``
- Line 95: `const RESERVED_PATHS = new Set([LOADERS_RPC_PATH, '/__actions']);` (the `/__actions` literal stays; see plan-header deviation 3)

`packages/vite/src/hono-preact.ts` (import `CLIENT_ENTRY_FILE`):
- The client output config: `entryFileNames: CLIENT_ENTRY_FILE,` (chunk/asset name patterns stay literal)

`packages/vite/src/client-entry.ts` (import `VIRTUAL_CLIENT_ID`):

```ts
export const VIRTUAL_CLIENT_ENTRY_ID = VIRTUAL_CLIENT_ID;
```

(The exported name `VIRTUAL_CLIENT_ENTRY_ID` stays; tests and the resolved-id derivation reference it.)

`packages/vite/src/module-key-plugin.ts` (import `MODULE_KEY_EXPORT`):
- Line 35, the already-transformed guard, built from the constant so it cannot drift:

```ts
      const alreadyKeyed = new RegExp(
        `^\\s*export\\s+const\\s+${MODULE_KEY_EXPORT}\\s*=`,
        'm'
      );
      if (alreadyKeyed.test(code)) return;
```

- Line 39: `` s.prepend(`export const ${MODULE_KEY_EXPORT} = ${JSON.stringify(key)};\n`); ``
- Line 84: `` `, { ${MODULE_KEY_EXPORT}: ${JSON.stringify(key)}${namePart} }` ``
- Line 99: `` `${MODULE_KEY_EXPORT}: ${JSON.stringify(key)}, ${namePart}` ``

`packages/vite/src/server-only.ts` (import `MODULE_KEY_EXPORT, FORM_MODULE_FIELD, FORM_ACTION_FIELD`):
- Line 235: `` `      ${MODULE_KEY_EXPORT}: ${JSON.stringify(moduleKey)},\n` ``
- Line 270: `` `    const stub = { ${FORM_MODULE_FIELD}: ${JSON.stringify(moduleKey)}, ${FORM_ACTION_FIELD}: String(action) };\n` ``

Preserve the surrounding template-string content byte-for-byte; the generated output must be identical to before (the vite test suites assert generated source text and will catch any whitespace drift).

- [ ] **Step 4: Run the vite suite and typecheck**

```bash
pnpm exec vitest run packages/vite/src
pnpm --filter '@hono-preact/vite' exec tsc --noEmit
```

Expected: PASS unchanged plus the new parity test (the generated-source assertions in `server-entry.test.ts`, `client-entry.test.ts`, `module-key-server-loaders.test.ts`, `server-only-plugin.test.ts`, and `path-key-parity.test.ts` pin that the interpolated output is byte-identical). The existing `path-key-parity.test.ts` needs no changes; with both codegen sites interpolating `MODULE_KEY_EXPORT` it now pins wire behavior over one shared spelling.

- [ ] **Step 5: Verify the umbrella consolidation rewrites the new import**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
rg "@hono-preact/iso" packages/hono-preact/dist/vite/ || echo "CONSOLIDATION OK: no unrewritten specifiers"
```

Expected: `CONSOLIDATION OK` (consolidate.mjs's DIST_PATHS table already maps `@hono-preact/iso/internal`; this step proves it applied to the new imports).

- [ ] **Step 6: Format and commit**

`pnpm format`; `git status` shows the six vite files, the new test, package.json, and pnpm-lock.yaml. Then:

```bash
git add packages/vite/package.json pnpm-lock.yaml packages/vite/src/server-entry.ts packages/vite/src/hono-preact.ts packages/vite/src/client-entry.ts packages/vite/src/module-key-plugin.ts packages/vite/src/server-only.ts packages/vite/src/__tests__/template-parity.test.ts
git commit -m "refactor(vite): interpolate wire-contract constants into codegen

vite gains a build-time @hono-preact/iso dependency for the contract
module; generated output is byte-identical. Adds the wrangler-template
parity test guarding the generated-entry path.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification (CI mirror)

**Files:** none (verification only)

- [ ] **Step 1: Run the six CI steps in order, from the repo root**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all six PASS. If `format:check` fails, `pnpm format` and commit the fallout. Note: `test:integration` includes the network-dependent scaffold test.

- [ ] **Step 2: Commit any formatting fallout**

```bash
git add -A && git commit -m "chore: pnpm format

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip if clean.)

---

### Task 6: PR

- [ ] **Step 1: Push and open the PR** (only after every Task 5 step passed)

```bash
git push -u origin feat/contract-constants
gh pr create --title "refactor: shared wire-contract constants module" --body "$(cat <<'EOF'
PR 3 of 3 for Section A of the primitives DX review (spec: docs/superpowers/specs/2026-06-10-semantics-consolidation-design.md). Closes out Section A.

- New `packages/iso/src/internal/contract.ts`: one exported constant per cross-package literal (`/__loaders`, `static/client.js` + URL form, the virtual client id + derived dev URL, `__moduleKey`, `__module`, `__action`), each documenting every consumer. Exact values pinned by test; changing one is a breaking change and now fails loudly in one place.
- iso, server, and vite consumers rewired onto the constants. vite gains a build-time `@hono-preact/iso` dependency; its codegen interpolates the constants, so generated output is byte-identical (pinned by the existing generated-source tests). The umbrella consolidation already rewrites the new import specifier (verified against the built dist).
- New wrangler-template parity test in packages/vite guards the generated-entry path against scaffolder drift (the template cannot import the constant). The generated-entry path constant itself stays in vite where it already lives; `/__actions` stays a literal since Section D plans to delete it.
- Standing rule adopted from the review (Section F): cross-package contracts start in this module, not as matching string literals.

Zero behavior change; all values identical.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Deep PR review**

Per the project PR workflow, immediately run a deep review as the first post-open step. Replacement-parity focus: for each constant, enumerate every pre-PR literal occurrence (from the deletion diff) and verify the constant landed at each value position with an identical value; confirm codegen output is byte-identical by reading the generated-source test expectations; confirm no typed-property position was clumsily converted to bracket access.
