# Site AGENTS.md Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/site` and the `AGENTS.md` contract agree, and add a vitest drift gate so the site cannot silently drift out of conformance again.

**Architecture:** A small AST-based checker (under `apps/site/src/__tests__/`) parses each app-code source with `@babel/parser` and reports its import specifiers and type-cast expressions. A vitest gate runs the checker over `apps/site/src/**/*.{ts,tsx}` (excluding `.mdx` and `__tests__`) and asserts three rules: no `react` imports (R1), no `/internal` or `@hono-preact/*` imports (R2), and no cast outside a commented allowlist (R5). The audit reshapes every reshapeable cast and allowlists the genuine boundaries. A docs pass fixes the one incorrect line in `AGENTS.md`.

**Tech Stack:** TypeScript, Preact, vitest, `@babel/parser` + `@babel/types` (both already `apps/site` devDependencies; the same parser the framework's `serverLoaderValidationPlugin` uses).

## Global Constraints

- No em-dashes in prose, code comments, or commit messages.
- Do not commit or push unless explicitly authorized; subagent-driven per-task commits defined by this plan are pre-authorized once the plan is approved.
- All work happens in the worktree `worktree-chore+site-agents-conformance`. Serena indexes the main checkout, so use rg / Read / Edit here, not Serena symbol/edit tools.
- The gate scans **app code only**: `apps/site/src/**/*.{ts,tsx}`, excluding `**/*.mdx` and `**/__tests__/**`. Never read `.mdx` bodies in the gate.
- Prefer reshaping a type over casting (CLAUDE.md "type casts"). Allowlisting is the fallback for genuine boundaries only.
- After each task, run the relevant test; the plan ends each task in a green state.
- Final pre-push verification mirrors CI exactly (six steps): `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:coverage` (or `pnpm test`), `pnpm test:integration`, `pnpm --filter site build`. `pnpm format` fixes format:check failures.

---

### Task 1: Conformance checker module + self-tests

Build the pure AST checker and prove it correct on in-memory fixtures (the mutation check). No filesystem or live scan yet.

**Files:**
- Create: `apps/site/src/__tests__/agents-conformance-checker.ts`
- Create: `apps/site/src/__tests__/agents-conformance.test.ts`

**Interfaces:**
- Produces:
  - `collectImports(source: string, tsx: boolean): string[]` - every import/export/dynamic-import module specifier in the source.
  - `collectCasts(source: string, tsx: boolean): { expr: string }[]` - every `x as T` / `<T>x` assertion except `as const`. `expr` is the cast's source text, whitespace-collapsed.

- [ ] **Step 1: Write the failing self-tests**

Create `apps/site/src/__tests__/agents-conformance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  collectImports,
  collectCasts,
} from './agents-conformance-checker.js';

describe('conformance checker (self-test)', () => {
  it('collectImports finds static, re-export, and dynamic specifiers', () => {
    const src = `
      import { useState } from 'preact/hooks';
      import x from 'react';
      export { y } from '@hono-preact/iso';
      const m = await import('hono-preact/internal');
    `;
    const specs = collectImports(src, false);
    expect(specs).toContain('preact/hooks');
    expect(specs).toContain('react');
    expect(specs).toContain('@hono-preact/iso');
    expect(specs).toContain('hono-preact/internal');
  });

  it('collectCasts finds as-expressions and angle-bracket assertions', () => {
    const src = `
      const a = foo as Bar;
      const b = <Baz>qux;
      const c = e.data as WorkerOutMsg;
    `;
    const casts = collectCasts(src, false).map((c) => c.expr);
    expect(casts).toContain('foo as Bar');
    expect(casts).toContain('e.data as WorkerOutMsg');
    expect(casts.some((c) => c.includes('Baz'))).toBe(true);
  });

  it('collectCasts ignores `as const`', () => {
    const casts = collectCasts(`const a = [1, 2] as const;`, false);
    expect(casts).toHaveLength(0);
  });

  it('collectCasts handles tsx and ignores generic calls / import aliases', () => {
    const src = `
      import { Map as MapIcon } from 'lucide-preact';
      const r = useRef<HTMLDivElement>(null);
      const v = (x) => x;
    `;
    expect(collectCasts(src, true)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run apps/site/src/__tests__/agents-conformance.test.ts`
Expected: FAIL - cannot resolve `./agents-conformance-checker.js`.

- [ ] **Step 3: Implement the checker**

Create `apps/site/src/__tests__/agents-conformance-checker.ts`:

```ts
// AST checker for the AGENTS.md conformance gate. Pure functions over source
// text - no filesystem. Lives under __tests__ so the live scan excludes it and
// vitest does not collect it as a suite (the include glob matches *.test.ts).
//
// `any` is used freely here to walk Babel's untyped node graph generically;
// this is test infrastructure, excluded from the gate's own scan.
import { parse } from '@babel/parser';

type AnyNode = { type?: string; start?: number; end?: number } & Record<
  string,
  unknown
>;

function parseSource(source: string, tsx: boolean) {
  return parse(source, {
    sourceType: 'module',
    plugins: tsx ? ['typescript', 'jsx'] : ['typescript'],
    errorRecovery: true,
  });
}

// Visit every node in the tree. Recurses into arrays and objects that look
// like AST nodes (have a string `type`); skips position/comment metadata.
function walk(node: unknown, visit: (n: AnyNode) => void): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AnyNode;
  if (typeof n.type === 'string') visit(n);
  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range')
      continue;
    const val = n[key];
    if (Array.isArray(val)) {
      for (const child of val) walk(child, visit);
    } else if (val && typeof val === 'object') {
      walk(val, visit);
    }
  }
}

export function collectImports(source: string, tsx: boolean): string[] {
  const ast = parseSource(source, tsx);
  const out: string[] = [];
  walk(ast.program, (n) => {
    if (
      (n.type === 'ImportDeclaration' ||
        n.type === 'ExportNamedDeclaration' ||
        n.type === 'ExportAllDeclaration' ||
        n.type === 'ImportExpression') &&
      n.source &&
      typeof (n.source as AnyNode).value === 'string'
    ) {
      out.push((n.source as AnyNode).value as string);
    }
  });
  return out;
}

function isAsConst(typeAnnotation: AnyNode | undefined): boolean {
  // `x as const` parses to a TSAsExpression whose typeAnnotation is a
  // TSTypeReference to the identifier `const`.
  if (!typeAnnotation) return false;
  if (typeAnnotation.type !== 'TSTypeReference') return false;
  const name = typeAnnotation.typeName as AnyNode | undefined;
  return name?.type === 'Identifier' && name.name === 'const';
}

export function collectCasts(
  source: string,
  tsx: boolean
): { expr: string }[] {
  const ast = parseSource(source, tsx);
  const out: { expr: string }[] = [];
  walk(ast.program, (n) => {
    if (n.type === 'TSAsExpression' || n.type === 'TSTypeAssertion') {
      if (isAsConst(n.typeAnnotation as AnyNode | undefined)) return;
      const text = source
        .slice(n.start ?? 0, n.end ?? 0)
        .replace(/\s+/g, ' ')
        .trim();
      out.push({ expr: text });
    }
  });
  return out;
}
```

- [ ] **Step 4: Run the self-tests to verify they pass**

Run: `pnpm exec vitest run apps/site/src/__tests__/agents-conformance.test.ts`
Expected: PASS (4 tests). If `as const` is not excluded, inspect the parsed node shape and adjust `isAsConst` (see spec risk note).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/__tests__/agents-conformance-checker.ts apps/site/src/__tests__/agents-conformance.test.ts
git commit -m "test(site): AST conformance checker + self-tests"
```

---

### Task 2: Live R1/R2 gate

Wire the file walker and assert no `react` imports (R1) and no `/internal` or `@hono-preact/*` imports (R2) across app code. Both pass immediately (the tree is already clean); this locks them in.

**Files:**
- Modify: `apps/site/src/__tests__/agents-conformance.test.ts`

**Interfaces:**
- Consumes: `collectImports` from Task 1.
- Produces: `appCodeFiles(): string[]` (absolute paths) and `relativeToSiteSrc(abs): string`, reused by Task 4.

- [ ] **Step 1: Write the failing live test**

Append to `apps/site/src/__tests__/agents-conformance.test.ts` (add imports at top:
`import { readdirSync, readFileSync } from 'node:fs';`,
`import { resolve, dirname, relative } from 'node:path';`,
`import { fileURLToPath } from 'node:url';`):

```ts
const here = dirname(fileURLToPath(import.meta.url));
const siteSrc = resolve(here, '..'); // apps/site/src

function appCodeFiles(): string[] {
  const files: string[] = [];
  const walkDir = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walkDir(resolve(dir, entry.name));
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(resolve(dir, entry.name));
      }
    }
  };
  walkDir(siteSrc);
  return files;
}

const relativeToSiteSrc = (abs: string) =>
  relative(siteSrc, abs).split('\\').join('/');

describe('AGENTS.md conformance (live apps/site)', () => {
  const files = appCodeFiles();

  it('R1: no react / react-dom imports', () => {
    const violations: string[] = [];
    for (const f of files) {
      const tsx = f.endsWith('.tsx');
      for (const spec of collectImports(readFileSync(f, 'utf8'), tsx)) {
        if (/^react(-dom)?(\/|$)/.test(spec)) {
          violations.push(`${relativeToSiteSrc(f)}: imports '${spec}'`);
        }
      }
    }
    expect(
      violations,
      `Use preact/hooks and preact, not react:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('R2: framework imports stay on the public surface', () => {
    const violations: string[] = [];
    for (const f of files) {
      const tsx = f.endsWith('.tsx');
      for (const spec of collectImports(readFileSync(f, 'utf8'), tsx)) {
        if (spec.includes('/internal') || spec.startsWith('@hono-preact/')) {
          violations.push(`${relativeToSiteSrc(f)}: imports '${spec}'`);
        }
      }
    }
    expect(
      violations,
      `Import from the public surface (hono-preact, hono-preact/page, ` +
        `hono-preact/server, hono-preact-ui), not internals:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the live R1/R2 tests**

Run: `pnpm exec vitest run apps/site/src/__tests__/agents-conformance.test.ts`
Expected: PASS (R1 and R2 green; the tree is already clean). If either fails, the violation list names the file and specifier - fix the import to a public path before proceeding.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/__tests__/agents-conformance.test.ts
git commit -m "test(site): gate react and internal-import conformance (R1/R2)"
```

---

### Task 3: Reshape the reshapeable casts

Remove the casts that a type reshape eliminates. Each step is verified by `pnpm typecheck`. Do not touch the genuine-boundary casts (Task 4 allowlists those).

**Files:**
- Modify: `apps/site/src/pages/demo/project-board.server.ts:37`
- Modify: `apps/site/src/pages/demo/task.tsx:183`
- Modify: `apps/site/src/components/demo/pickers.tsx` (StatusSelect, PrioritySelect, AssigneeCombobox)

- [ ] **Step 1: Reshape `filter(Boolean) as User[]` to a type predicate**

In `project-board.server.ts`, replace:

```ts
      users: [getUser('u-1'), getUser('u-2')].filter(Boolean) as User[],
```

with (getUser returns `User | null`, so the predicate narrows out null):

```ts
      users: [getUser('u-1'), getUser('u-2')].filter(
        (u): u is User => u !== null
      ),
```

- [ ] **Step 2: Reshape `} as CommentData` to a typed binding**

In `task.tsx`, change the optimistic `apply` so the new element is a typed binding rather than a cast. Replace the spread-with-cast:

```ts
    apply: (current, payload) => [
      ...current,
      {
        id: `pending-${current.length}`,
        taskId: payload.taskId,
        authorId: '',
        body: payload.body,
        createdAt: Date.now(),
        author: null,
      } as CommentData,
    ],
```

with:

```ts
    apply: (current, payload) => {
      const optimistic: CommentData = {
        id: `pending-${current.length}`,
        taskId: payload.taskId,
        authorId: '',
        body: payload.body,
        createdAt: Date.now(),
        author: null,
      };
      return [...current, optimistic];
    },
```

If `pnpm typecheck` now reports a real mismatch (a field whose type does not fit `CommentData = WithAuthor<Comment>`), that mismatch was being hidden by the cast: fix the offending field to match `CommentData` rather than reinstating the cast.

- [ ] **Step 3: Reshape the picker Select casts via the generic value type**

`SelectRoot` is generic: `function SelectRoot<Value = string>(props: SelectRootProps<Value>)`. Parameterize it so `onValueChange` yields the literal union and the cast disappears. In `pickers.tsx` StatusSelect, replace:

```tsx
    <Select.Root
      value={value}
      onValueChange={(v) =>
        onChange((Array.isArray(v) ? (v[0] ?? value) : v) as TaskStatus)
      }
    >
```

with:

```tsx
    <Select.Root<TaskStatus>
      value={value}
      onValueChange={(v) =>
        onChange(Array.isArray(v) ? (v[0] ?? value) : v)
      }
    >
```

Apply the same change to PrioritySelect with `<Select.Root<TaskPriority>>`. For AssigneeCombobox, parameterize `Combobox.Root` the same way (the value type is `string`) so `(Array.isArray(v) ? (v[0] ?? '') : v) as string` loses its `as string`.

If the explicit type-argument JSX syntax (`<Select.Root<TaskStatus>>`) does not typecheck under this TS/Preact setup, fall back to a typed handler that keeps inference local: extract `const handleChange = (v: TaskStatus | TaskStatus[]) => onChange(Array.isArray(v) ? (v[0] ?? value) : v);` and pass `onValueChange={handleChange}`. The success criterion is that the checker no longer reports these casts AND `pnpm typecheck` passes - do not reintroduce a cast to satisfy the syntax.

- [ ] **Step 4: Verify the reshapes typecheck and the casts are gone**

Run: `pnpm typecheck`
Expected: PASS.

Run a quick enumeration to confirm these specific casts are gone:
`pnpm exec vitest run apps/site/src/__tests__/agents-conformance.test.ts` (R5 is not wired yet; this just confirms R1/R2 still pass). The authoritative R5 check arrives in Task 4.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/demo/project-board.server.ts apps/site/src/pages/demo/task.tsx apps/site/src/components/demo/pickers.tsx
git commit -m "refactor(site): reshape demo casts to typed predicates/generics"
```

---

### Task 4: Live R5 gate + honest allowlist

Wire the live cast assertion against a commented allowlist seeded with the genuine boundaries that remain after Task 3, and enforce stale-entry honesty.

**Files:**
- Modify: `apps/site/src/__tests__/agents-conformance.test.ts`

**Interfaces:**
- Consumes: `collectCasts` (Task 1), `appCodeFiles` / `relativeToSiteSrc` (Task 2).

- [ ] **Step 1: Add the allowlist and the failing R5 test**

Append to `apps/site/src/__tests__/agents-conformance.test.ts`, inside the live describe block:

```ts
  // Genuine type-cast boundaries. Each entry is keyed by repo-relative file
  // path plus the exact (whitespace-collapsed) cast expression, and carries a
  // one-line reason. Prefer reshaping the type over adding an entry here.
  const CAST_ALLOWLIST: { file: string; expr: string; reason: string }[] = [
    {
      file: 'demo/session.ts',
      expr: 'JSON.parse(raw) as CookiePayload',
      reason: 'parsing an untrusted cookie payload (acceptable boundary)',
    },
    {
      file: 'hooks/use-board-drag.ts',
      expr: 'card.cloneNode(true) as HTMLElement',
      reason: 'Node.cloneNode returns Node; the source is an HTMLElement',
    },
    {
      file: 'hooks/use-board-drag.ts',
      expr: 'e.currentTarget as HTMLElement',
      reason: 'DOM event currentTarget is EventTarget | null at the type level',
    },
    {
      file: 'components/HeroShader.tsx',
      expr: 'e.data as WorkerOutMsg',
      reason: 'Worker MessageEvent.data is any (untyped postMessage boundary)',
    },
    {
      file: 'components/shader-worker.ts',
      expr: 'e.data as WorkerInMsg',
      reason: 'Worker MessageEvent.data is any (untyped postMessage boundary)',
    },
    {
      file: 'components/demo/TaskCard.tsx',
      expr: 'e as PointerEvent',
      reason: 'bridging the Preact pointer-handler event to the DOM PointerEvent',
    },
    {
      file: 'components/demo/TaskActions.tsx',
      expr: 'v as TaskStatus',
      reason: 'MenuRadioGroup.onValueChange yields string; values are the fixed TaskStatus set',
    },
    {
      file: 'components/demo/TaskActions.tsx',
      expr: 'v as TaskPriority',
      reason: 'MenuRadioGroup.onValueChange yields string; values are the fixed TaskPriority set',
    },
  ];

  it('R5: no casts outside the allowlist', () => {
    const allowed = new Set(
      CAST_ALLOWLIST.map((e) => `${e.file}|${e.expr}`)
    );
    const seen = new Set<string>();
    const violations: string[] = [];
    for (const f of files) {
      const rel = relativeToSiteSrc(f);
      const tsx = f.endsWith('.tsx');
      for (const { expr } of collectCasts(readFileSync(f, 'utf8'), tsx)) {
        const key = `${rel}|${expr}`;
        seen.add(key);
        if (!allowed.has(key)) {
          violations.push(`${rel}: ${expr}`);
        }
      }
    }
    expect(
      violations,
      `Reshape the type (predicate, typed binding, generic value) or add an ` +
        `allowlist entry with a reason:\n${violations.join('\n')}`
    ).toEqual([]);

    // Honesty: every allowlist entry must still correspond to a real cast.
    const stale = [...allowed].filter((k) => !seen.has(k));
    expect(stale, `Remove stale allowlist entries:\n${stale.join('\n')}`).toEqual(
      []
    );
  });
```

- [ ] **Step 2: Run R5 and reconcile against the live enumeration**

Run: `pnpm exec vitest run apps/site/src/__tests__/agents-conformance.test.ts`
Expected: PASS. If R5 fails with a violation the AST found but this plan did not anticipate (for example an `as string` the regex sample missed), decide per the same rule: reshape it (re-run Task 3 style) if a type fix removes it, otherwise add a `CAST_ALLOWLIST` entry with a one-line reason. If R5 fails with a stale entry, a Task 3 reshape removed a cast that is still listed - delete that allowlist entry.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/__tests__/agents-conformance.test.ts
git commit -m "test(site): gate type casts against an honest allowlist (R5)"
```

---

### Task 5: Fix the incorrect AGENTS.md line + scan the docs corpus

**Files:**
- Modify: `packages/create-hono-preact/templates/agents/AGENTS.md` (the `.server` bullet, around line 30)
- Modify: any `apps/site/src/pages/docs/**/*.mdx` that repeats the same contradiction (scan first)

- [ ] **Step 1: Reword the AGENTS.md `.server` rule**

In `AGENTS.md`, the bullet currently ends:

```
  `serverActions` are the only allowed named exports. Never import a `.server`
  symbol into client code.
```

Replace the false sentence so it states the real contract:

```
  `serverActions` are the only allowed named exports (plus erased `export
  type`s). Client code imports `serverLoaders` / `serverActions` and reads data
  through them; the Vite plugin rewrites those imports into client-safe RPC
  handles. Never put secrets or server-only helpers where they would be inlined
  into the client; keep that logic inside the loader and action bodies.
```

- [ ] **Step 2: Scan the docs corpus for the same contradiction**

Run: `rg -ni "never import.*\.server|don't import.*server|do not import.*server" apps/site/src/pages/docs`
Expected: review every hit. Fix any prose that tells the reader not to import `serverLoaders`/`serverActions` into client code so it matches the corrected AGENTS.md wording. (If there are no hits, record that and move on.)

- [ ] **Step 3: Verify the appendix invariant still holds**

Run: `pnpm exec vitest run packages/create-hono-preact/__tests__/agents-appendix.test.ts`
Expected: PASS (the edit changed prose, not the entry-point appendix list).

- [ ] **Step 4: Commit**

```bash
git add packages/create-hono-preact/templates/agents/AGENTS.md
# plus any docs/*.mdx changed in Step 2
git commit -m "docs(agents): correct the .server import rule to match the framework"
```

---

### Task 6: Full pre-push verification + PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Run the six CI steps in order**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm --filter site build
```

Expected: all pass. If `format:check` fails, run `pnpm format`, review, and commit the result. Do not proceed until every step is green and personally observed.

- [ ] **Step 2: Push the branch and open the PR to `main`**

(Only after explicit user authorization to push.) Open a PR whose description enumerates: the gate rules (R1/R2/R5), the cast dispositions (reshaped vs allowlisted, with reasons), the dropped R3/R4 with rationale, and the AGENTS.md correction. Then run the mandated deep PR review as the first follow-up.

---

## Self-Review

**Spec coverage:**
- Phase A audit (cast triage) -> Tasks 3, 4. Structural spot-check -> done during Task 3/4 review and recorded in the PR description (Task 6 Step 2).
- Phase B gate (R1/R2/R5, AST, allowlist, anchoring, scan-set, self-test) -> Tasks 1, 2, 4.
- Phase C docs correction (AGENTS.md + corpus scan + appendix re-run) -> Task 5.
- App-code-vs-docs split (exclude .mdx + __tests__) -> Task 2 walker, reused in Task 4.
- Dropped R3/R4 -> not gated (correctly absent); rationale recorded in the PR description.

**Placeholder scan:** no TBD/TODO. The one investigation-dependent step (Task 3 Step 3 JSX generic syntax) specifies both the primary fix and a concrete fallback with an explicit success criterion, and Task 4 Step 2 gives a concrete reconcile rule for any cast the AST finds beyond the sample. These are bounded decisions with defined outcomes, not open-ended placeholders.

**Type consistency:** `collectImports`/`collectCasts` signatures match between Task 1 (defined) and Tasks 2/4 (consumed). `appCodeFiles`/`relativeToSiteSrc` defined in Task 2, reused in Task 4. Allowlist key format (`${file}|${expr}`) is consistent within Task 4.
