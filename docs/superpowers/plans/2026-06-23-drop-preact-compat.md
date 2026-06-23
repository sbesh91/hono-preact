# Drop `preact/compat` From the Framework Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The shipped `hono-preact` runtime never loads `preact/compat`, so compat's global preact-renderer `options` patches never run, with a guard test that turns a future silent breakage into a red CI failure.

**Architecture:** A feasibility spike (commits `53a9a55` + `bfa9520`, on this branch) already produced a verified-passing prototype: a compat-free `Suspense` ported from compat's `suspense.js` into `packages/iso/src/internal/suspense.tsx` (imports only preact core), the 3 Suspense consumers repointed, both `useSyncExternalStore` call sites swapped to the repo's `useReducer`+`useEffect`+`subscribe` pattern, `@preact/preset-vite` invoked with `reactAliasesEnabled: false`, `'preact/compat'` removed from `resolve.dedupe`, and the `apps/site` aliases deleted. This plan hardens that prototype into a production PR: it reviews the risky Suspense port, adds the mandatory mangle-map guard test, documents the one behavioral trade in the hook swap, syncs docs + scaffolds, records the breaking-change surface, and runs the full CI gate.

**Tech Stack:** preact 10.29.1 (core only), preact-render-to-string 6.6.7, @preact/preset-vite 2.10.5, vitest 4, @testing-library/preact.

## Global Constraints

- **All-or-nothing:** a single remaining `preact/compat` import keeps compat's `options` patches active. The end state must have zero `preact/compat` / `@preact/compat` imports in shipped source (`packages/*/src`, `apps/site/src`), excluding comments and the standalone `leak-test` fixture.
- **Mangled-name coupling is deliberate and guarded.** `@hono-preact/iso` builds unmangled with `tsc`, so `suspense.tsx` must reference preact's mangled internal names (`options.__e`, `vnode.__c`, `__k`, `__u`, ...). This is accepted. The guard test (Task 2) is mandatory and MUST be mutation-checked (proven to fail if a mangled key is wrong).
- **Acceptable casts:** the two `as unknown as` seams in `suspense.tsx` (viewing `options` and `this` as their internal mangled shapes) are the allowed "structural reads off the runtime" boundary per `CLAUDE.md`. Do not add more casts; prefer the declared `InternalVNode`/`InternalComponent`/`InternalOptions` reshape.
- **Decision (locked): keep the faithful port intact.** Do NOT surgically remove the SuspenseList (`__a`) machinery or attempt to add `lazy`. `__a` is read in the component's own render path, not only by SuspenseList, so partial removal risks regressing core suspension. Matching compat exactly is lower-risk than trimming. `lazy` stays unported (framework uses loader/`wrapPromise`).
- No em-dashes in prose, comments, or commit messages. Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- All work in the worktree `.claude/worktrees/remove-preact-compat/` on branch `worktree-remove-preact-compat`. Never commit to the primary checkout. No `git push` / PR unless explicitly asked.
- The spike commits are the verified baseline (independently re-verified: typecheck 0 errors, 5 hydration-sensitive test files / 41 tests pass, integration 7/7, zero compat runtime signatures in the built client bundle). Build forward on them.
- Definition of done: the 8-step pre-push CI gate (`CLAUDE.md`) plus the spec's change-specific checks all pass (Task 6).

---

### Task 1: Review and harden the compat-free Suspense module

**Files:**
- Modify: `packages/iso/src/internal/suspense.tsx`

**Interfaces:**
- Consumes: preact core (`Component`, `createElement`, `Fragment`, `options`) only.
- Produces: the finalized internal `Suspense` (named export) that `route-boundary.tsx`, `loader.tsx`, `page-middleware-host.tsx` already import from `./suspense.js`. Signature unchanged: `Suspense(props: { fallback?: ComponentChildren; children: ComponentChildren })`.

- [ ] **Step 1: Read the spike's module and confirm correctness against compat's source**

Read `packages/iso/src/internal/suspense.tsx` and `node_modules/.pnpm/preact@10.29.1/node_modules/preact/compat/src/suspense.js` side by side. Confirm the port faithfully reproduces: the `options._catchError` (`__e`) promise-walk, `_childDidSuspend` bookkeeping, the detach/restore of the suspended subtree, and the hydration branch that does NOT set `_suspended` (`__a`) so SSR DOM is adopted. Note any divergence in the report; do not "improve" the algorithm.

- [ ] **Step 2: Add a guard-once flag around the module-level `options` patches**

The module patches `options.__e` and `options.unmount` at import time, chaining the previous handlers. ESM caching already makes this run once, but add a defensive idempotency guard so a double-import cannot double-wrap. At the top of the patch block:

```ts
// Defensive: ESM caches this module so the patch runs once, but guard anyway so
// a duplicated module instance can never double-wrap the chained handlers.
const PATCHED = Symbol.for('hono-preact.suspense.patched');
const opts = options as unknown as InternalOptions & { [PATCHED]?: true };
if (!opts[PATCHED]) {
  opts[PATCHED] = true;
  const oldCatchError = opts.__e;
  // ... existing patch body assigning opts.__e = function (...) { ... oldCatchError ... }
  const oldUnmount = opts.unmount;
  // ... existing opts.unmount patch chaining oldUnmount
}
```

Keep the existing patch bodies; only wrap them in the `if (!opts[PATCHED])` guard and read the previous handlers inside it.

- [ ] **Step 3: Confirm the type reshape is minimal**

Verify `InternalVNode` / `InternalComponent` / `InternalOptions` declare exactly the mangled fields the module reads, and that only the two documented `as unknown as` seams exist (no per-access casts). If any stray `as` cast was added, fold it into the declared interface instead.

- [ ] **Step 4: Build iso and typecheck**

Run:
```bash
pnpm --filter @hono-preact/iso build && pnpm --filter @hono-preact/iso exec tsc --noEmit
```
Expected: exit 0, no `error TS` lines.

- [ ] **Step 5: Run the existing suspense/hydration-sensitive suites**

Run:
```bash
pnpm vitest run packages/iso/src/internal/__tests__/loader.test.tsx packages/iso/src/internal/__tests__/page-middleware-host.test.tsx
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/suspense.tsx
git commit -m "refactor(iso): harden compat-free Suspense with idempotent options patch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add the mangle-map guard test (and concurrent-suspension coverage)

**Files:**
- Create: `packages/iso/src/internal/__tests__/suspense-guard.test.tsx`

**Interfaces:**
- Consumes: `Suspense` from `../suspense.js`; `options` from `preact`; `render`, `waitFor` from `@testing-library/preact`.
- Produces: a CI canary that fails loudly if preact's mangle map shifts so suspension breaks.

- [ ] **Step 1: Write the guard test**

Create `packages/iso/src/internal/__tests__/suspense-guard.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/preact';
import { options } from 'preact';
import type { ComponentChildren } from 'preact';
import { Suspense } from '../suspense.js';

/** A child that throws a promise until it is resolved, then renders text. */
function makeSuspender(text: string) {
  let resolveFn!: () => void;
  let done = false;
  const promise = new Promise<void>((r) => {
    resolveFn = () => {
      done = true;
      r();
    };
  });
  const Child = () => {
    if (!done) throw promise;
    return <div>{text}</div>;
  };
  return { Child, resolve: resolveFn, promise };
}

describe('compat-free Suspense (mangle-map guard)', () => {
  it('catches a thrown promise, shows fallback, then resolves to content', async () => {
    const { Child, resolve, promise } = makeSuspender('loaded');
    const { getByText, queryByText } = render(
      <Suspense fallback={<span>loading</span>}>
        <Child />
      </Suspense>
    );
    // Fallback is shown while suspended: proves __e walked to _childDidSuspend.
    expect(getByText('loading')).toBeTruthy();
    expect(queryByText('loaded')).toBeNull();
    resolve();
    await promise;
    await waitFor(() => expect(getByText('loaded')).toBeTruthy());
  });

  it('resolves two sibling suspenders under one boundary out of order', async () => {
    const a = makeSuspender('A');
    const b = makeSuspender('B');
    const { getByText, queryByText } = render(
      <Suspense fallback={<span>loading</span>}>
        <a.Child />
        <b.Child />
      </Suspense>
    );
    expect(getByText('loading')).toBeTruthy();
    // Resolve B first, then A: the boundary must wait for BOTH.
    b.resolve();
    await b.promise;
    expect(queryByText('A')).toBeNull();
    a.resolve();
    await a.promise;
    await waitFor(() => {
      expect(getByText('A')).toBeTruthy();
      expect(getByText('B')).toBeTruthy();
    });
  });

  it('preact still exposes the _catchError hook this module patches (canary)', () => {
    // If a preact bump renames the mangled __e key, suspension silently breaks
    // upstream; this assertion fails first and names the cause.
    expect('__e' in options).toBe(true);
    expect(typeof (options as Record<string, unknown>).__e).toBe('function');
  });
});
```

- [ ] **Step 2: Run the guard test, expect PASS**

Run:
```bash
pnpm vitest run packages/iso/src/internal/__tests__/suspense-guard.test.tsx
```
Expected: 3 tests pass.

- [ ] **Step 3: Mutation-check the guard (prove it fails on a broken mangle name)**

Temporarily edit `packages/iso/src/internal/suspense.tsx`: in the `options.__e` patch, change the walk that reads the child component's suspend hook to a wrong mangled key (e.g. read `.__cZZ` instead of `.__c`). Rebuild iso and re-run the guard test.

```bash
pnpm --filter @hono-preact/iso build
pnpm vitest run packages/iso/src/internal/__tests__/suspense-guard.test.tsx
```
Expected: the first two tests FAIL (fallback never resolves / promise rejects), proving the guard is load-bearing. Then REVERT the deliberate break, rebuild, and confirm the tests pass again. Record the failing output in the report.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/internal/__tests__/suspense-guard.test.tsx
git commit -m "test(iso): guard compat-free Suspense against preact mangle-map drift

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Finalize and document the `useSyncExternalStore` swap

**Files:**
- Modify: `packages/iso/src/use-action-result.ts`
- Modify: `packages/iso/src/use-form-status.ts`

**Interfaces:**
- Consumes: the existing store `subscribe` / snapshot getters in each file.
- Produces: unchanged public hook signatures (`useActionResult`, `useFormStatus`); behavior identical for these synchronous in-memory stores.

- [ ] **Step 1: Confirm the swap and add a documenting comment**

Verify both files use `useReducer` force-update + `useEffect(() => subscribe(forceUpdate), [])`, reading the snapshot inline during render behind `isBrowser()`. Above each subscription, add one comment recording the deliberate trade (do not change behavior):

```ts
// Compat-free subscription (no preact/compat useSyncExternalStore): useReducer
// force-update + useEffect(subscribe). useSyncExternalStore additionally re-reads
// the snapshot at subscribe time to close the render-to-effect tear window; this
// store is a synchronous in-memory store written only by post-mount submit
// events, so that window is empty in practice. See the 2026-06-23 drop-compat spec.
```

- [ ] **Step 2: Run the dependent suites**

Run:
```bash
pnpm vitest run packages/iso/src/__tests__/use-action-result.test.tsx packages/iso/src/__tests__/use-form-status.test.tsx packages/iso/src/__tests__/form.test.tsx
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/use-action-result.ts packages/iso/src/use-form-status.ts
git commit -m "refactor(iso): document the compat-free useSyncExternalStore swap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Confirm the Vite compat vectors are gone and assert it in the plugin test

**Files:**
- Modify (verify only): `packages/vite/src/hono-preact.ts`
- Modify: `packages/vite/src/__tests__/hono-preact.test.ts`

**Interfaces:**
- Consumes: the spike's `...preact({ reactAliasesEnabled: false })` and dedupe edit.
- Produces: a regression assertion that `'preact/compat'` is absent from `resolve.dedupe`.

- [ ] **Step 1: Verify the spike's vite changes are present**

Confirm `packages/vite/src/hono-preact.ts` calls `...preact({ reactAliasesEnabled: false })` and that `resolve.dedupe` no longer contains `'preact/compat'`:
```bash
grep -n "reactAliasesEnabled\|dedupe\|preact/compat" packages/vite/src/hono-preact.ts
```
Expected: `reactAliasesEnabled: false` present; no `'preact/compat'` in the dedupe array.

- [ ] **Step 2: Add a negative assertion to the existing plugin test**

In `packages/vite/src/__tests__/hono-preact.test.ts`, in the existing test that checks the shared `resolve.dedupe`, add:

```ts
expect(result.resolve.dedupe).not.toContain('preact/compat');
```
(Place it beside the existing `toContain('preact')` / `toContain('preact-iso')` assertions.)

- [ ] **Step 3: Run the vite plugin tests**

Run:
```bash
pnpm vitest run packages/vite/src/__tests__/hono-preact.test.ts
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/vite/src/__tests__/hono-preact.test.ts
git commit -m "test(vite): assert preact/compat is absent from resolve.dedupe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sync docs, scaffold templates, and the leak-test fixture

**Files:**
- Modify: `apps/site/src/pages/docs/vite-config.mdx`
- Modify: `packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts`
- Modify (if present): `packages/create-hono-preact/templates/**` vite config / package.json that carry react aliases or a `preact/compat` dedupe entry

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: docs + generated scaffolds that match the compat-free runtime so new apps are born compat-free.

- [ ] **Step 1: Find every scaffold/doc reference to the removed compat vectors**

Run:
```bash
grep -rn "preact/compat\|@preact/compat\|react-is\|npm:@preact" packages/create-hono-preact/templates apps/site/src/pages/docs/vite-config.mdx packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts
```
This is the worklist. Expect: the `vite-config.mdx` dedupe code sample, the leak-test fixture dedupe array, and any template react aliases / dedupe.

- [ ] **Step 2: Update `vite-config.mdx`**

In the dedupe row / code sample, change the listed dedupe set from `preact`, `preact/compat`, `preact/hooks`, `preact-iso` to `preact`, `preact/hooks`, `preact-iso` (drop `preact/compat`).

- [ ] **Step 3: Update the leak-test fixture**

In `packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts`, remove `'preact/compat'` from its `dedupe` array so the fixture documents the compat-free intent.

- [ ] **Step 4: Update scaffold templates if they carry compat**

For any template file from Step 1 that aliases `react`/`react-dom`/`react-is` to `@preact/compat` or lists `preact/compat` in dedupe, remove those entries. If Step 1 found none in templates, note that and skip. (The framework's own vite plugin now sets `reactAliasesEnabled: false`, so scaffolded apps inherit compat-free behavior without per-template config.)

- [ ] **Step 5: Regenerate the bundled corpus (templates feed it) and run scaffold tests**

Run:
```bash
pnpm gen:agents-corpus
pnpm vitest run packages/create-hono-preact
```
Expected: corpus regenerates; all create-hono-preact tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/docs/vite-config.mdx packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts packages/create-hono-preact
git commit -m "docs+scaffold: drop preact/compat references for the compat-free runtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Release note, full CI gate, and commit-history cleanup

**Files:**
- Modify: the current release-notes draft under `docs/superpowers/specs/` (the v0.8 / next-release notes; locate the most recent one)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a recorded breaking-change entry and green evidence across the full gate.

- [ ] **Step 1: Record the breaking-change surface**

Locate the current release-notes draft:
```bash
ls -t docs/superpowers/specs/*release-notes*.md | head -1
```
Append an entry recording the three export-diff-invisible breaking changes from the spec's "Breaking-change surface" section: `reactAliasesEnabled: false` (consumers relying on the implicit `react -> preact/compat` alias must add it themselves), compat's global `options` patches no longer load (apps depending on compat-only DOM/prop/event behavior change), and `'preact/compat'` removed from `resolve.dedupe`.

- [ ] **Step 2: Run the full pre-push CI gate (CLAUDE.md, in order)**

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
Expected: every step exits 0. If `format:check` fails, run `pnpm format`, commit with the trailer, and re-run. Capture each step's pass/fail summary line.

- [ ] **Step 3: Assert the bundle is compat-free**

Run:
```bash
grep -rlE "forwardRef|PureComponent|CAMEL_PROPS|hoistNonReact" apps/site/dist/client; echo "client-compat-sigs exit=$?"
grep -rl "@preact/compat" apps/site/dist/client; echo "client-@preact/compat exit=$?"
grep -rln "import .*'preact/compat'\|from 'preact/compat'" packages/*/src apps/site/src | grep -v "__tests__/fixtures/leak-test"; echo "source-imports exit=$?"
```
Expected: no compat runtime signatures and no `@preact/compat` in the client bundle (grep exit 1, empty); no `preact/compat` imports in shipped source (exit 1, empty).

- [ ] **Step 4: Clean up commit history**

Reword the two `spike:` commits (`53a9a55`, `bfa9520`) into proper conventional-commit messages so the PR history reads as production work, not a spike. Use a non-interactive approach (the environment blocks interactive rebase): create a fresh branch from `1af969a`'s parent ordering by cherry-picking, OR soft-reset to `1c2510b` and re-commit the squashed tree as logical commits. The simplest safe path:
```bash
# Squash the two spike commits + this plan's commits into a clear set.
# Verify the working tree is clean first.
git status --short
```
Decide the final commit grouping (suggested: one `feat(iso): compat-free Suspense + drop preact/compat` covering the runtime change, plus the test/docs/scaffold/release-note commits already made). Record the chosen grouping in the report. Do NOT force-push anything (no push at all unless asked).

- [ ] **Step 5: Final report**

Summarize every gate step's result with its actual output line, the guard-test mutation-check evidence, and the bundle-grep evidence. Do not claim success for any step not run. State the branch is ready for the user to decide on PR/merge.

---

## Self-Review

**Spec coverage:**
- Spec approach items 1-3 (Suspense module + repoint + hook swap) -> verified baseline (spike), reviewed/hardened in Tasks 1 + 3.
- Spec approach item 4 (preset-vite + dedupe) -> Task 4.
- Spec approach item 5 (site aliases) -> done in spike baseline; confirmed compat-free in Task 6 Step 3.
- Spec approach item 6 (guard test) -> Task 2 (with mandatory mutation-check).
- Spec approach item 7 (docs + scaffold sync) -> Task 5.
- Spec central decision (mangle coupling) -> Global Constraints + Task 2.
- Spec residual risks: #1 -> Task 2; #2/#3 (SuspenseList/lazy) -> Global Constraints decision (keep faithful port); #4 (concurrent suspenders) -> Task 2 Step 1 test; #5 (tear window) -> Task 3; #6 (patch idempotency) -> Task 1 Step 2.
- Spec breaking-change surface -> Task 6 Step 1.
- Spec verification -> Task 6 Steps 2-3.

**Placeholder scan:** No "TBD"/"TODO". The only conditional is Task 5 Step 4 (templates "if present"), which is gated on the Step 1 grep result and explicitly handles the empty case.

**Type/name consistency:** `Suspense` export name, the `InternalVNode`/`InternalComponent`/`InternalOptions` reshape names, and the `__e`/`__c` mangled keys are used consistently across Tasks 1, 2, and 6. Test file path `packages/iso/src/internal/__tests__/suspense-guard.test.tsx` is identical in Task 2 Steps 1-4.
