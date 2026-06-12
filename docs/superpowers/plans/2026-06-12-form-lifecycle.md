# Form lifecycle (Section C #1, PR 1: iso) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `Form` the success lifecycle (`onSuccess`/`onError`/`invalidate`/`reset`) it currently lacks, sharing `useAction`'s invalidation implementation via a new `useInvalidate()` hook, and delete the two site workarounds that hand-roll the missing behavior.

**Architecture:** Extract `useAction`'s inline `invalidate` logic into `useInvalidate()` (one implementation, two consumers), then add four optional props to `Form` that wire into the existing `handleSubmit` outcome switch (additive: the `setLastActionResult` / optimistic behavior is unchanged). `reset` builds on native `formEl.reset()` (which fires the standard `reset` event ui components will later subscribe to in PR 2).

**Tech Stack:** TypeScript, preact, Vitest + `@testing-library/preact` (happy-dom), plain `tsc` builds.

**Source spec:** `docs/superpowers/specs/2026-06-12-form-lifecycle-design.md` (Part A + Part C). PR 2 (the ui `Select`/`Combobox` reset participation, Part B) is planned separately against post-PR1 `main`.

**Conventions:**
- Run a single test file with `pnpm exec vitest run <path>` from the repo root.
- No em-dashes in code/comments/commit messages.
- Commit after each task; messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

## File map

- **Create** `packages/iso/src/use-invalidate.ts`: the shared invalidation hook.
- **Create** `packages/iso/src/__tests__/use-invalidate.test.tsx`: its unit tests.
- **Modify** `packages/iso/src/action.ts`: refactor `useAction` onto `useInvalidate`.
- **Modify** `packages/iso/src/form.tsx`: the four new props + per-outcome wiring + the `resetFormFields` helper.
- **Modify** `packages/iso/src/__tests__/form.test.tsx`: lifecycle tests.
- **Modify** `apps/site/src/pages/demo/project-issues.tsx` + `apps/site/src/pages/demo/issue.tsx`: delete the workarounds.
- **Modify** `apps/site/src/pages/docs/actions.mdx`: document the lifecycle props.

---

## Task 1: Extract `useInvalidate()` and refactor `useAction` onto it

**Files:**
- Create: `packages/iso/src/use-invalidate.ts`
- Create: `packages/iso/src/__tests__/use-invalidate.test.tsx`
- Modify: `packages/iso/src/action.ts`

- [ ] **Step 1: Write the hook's unit tests.** Create `packages/iso/src/__tests__/use-invalidate.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useInvalidate, type InvalidateInput } from '../use-invalidate.js';
import { ReloadContext } from '../reload-context.js';
import { ActiveLoaderIdContext } from '../internal/contexts.js';
import { defineLoader } from '../define-loader.js';

afterEach(cleanup);

function Harness({ input }: { input: InvalidateInput }) {
  const apply = useInvalidate();
  return <button onClick={() => apply(input)}>go</button>;
}

function click() {
  document.querySelector('button')!.click();
}

describe('useInvalidate', () => {
  it('calls reload() for "auto"', async () => {
    const reload = vi.fn();
    render(
      <ReloadContext.Provider value={{ reload, reloading: false }}>
        <Harness input="auto" />
      </ReloadContext.Provider>
    );
    await act(async () => click());
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does nothing for false', async () => {
    const reload = vi.fn();
    render(
      <ReloadContext.Provider value={{ reload, reloading: false }}>
        <Harness input={false} />
      </ReloadContext.Provider>
    );
    await act(async () => click());
    expect(reload).not.toHaveBeenCalled();
  });

  it('invalidates each ref in an array and reloads when the active loader is included', async () => {
    const active = defineLoader(async () => ({ value: 1 }), {
      __moduleKey: 'inv-active',
    });
    const other = defineLoader(async () => ({ value: 2 }), {
      __moduleKey: 'inv-other',
    });
    const invActive = vi.spyOn(active, 'invalidate');
    const invOther = vi.spyOn(other, 'invalidate');
    const reload = vi.fn();
    render(
      <ActiveLoaderIdContext.Provider value={active.__id}>
        <ReloadContext.Provider value={{ reload, reloading: false }}>
          <Harness input={[active, other]} />
        </ReloadContext.Provider>
      </ActiveLoaderIdContext.Provider>
    );
    await act(async () => click());
    expect(invActive).toHaveBeenCalled();
    expect(invOther).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('invalidates refs without reloading when none is the active loader', async () => {
    const other = defineLoader(async () => ({ value: 2 }), {
      __moduleKey: 'inv-only-other',
    });
    const invOther = vi.spyOn(other, 'invalidate');
    const reload = vi.fn();
    render(
      <ActiveLoaderIdContext.Provider value={null}>
        <ReloadContext.Provider value={{ reload, reloading: false }}>
          <Harness input={[other]} />
        </ReloadContext.Provider>
      </ActiveLoaderIdContext.Provider>
    );
    await act(async () => click());
    expect(invOther).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (cannot resolve `../use-invalidate.js`). `pnpm exec vitest run packages/iso/src/__tests__/use-invalidate.test.tsx`

- [ ] **Step 3: Create the hook.** Create `packages/iso/src/use-invalidate.ts`:

```ts
import { useCallback, useContext } from 'preact/hooks';
import { ReloadContext } from './reload-context.js';
import { ActiveLoaderIdContext } from './internal/contexts.js';
import type { LoaderRef } from './define-loader.js';

/** How to update loader caches after an action commits. Same vocabulary as
 * `useAction`'s `invalidate` option: `'auto'` re-runs the active page's loader;
 * an array calls `.invalidate()` on each `LoaderRef` (and re-runs the active
 * loader if it is in the list); `false`/undefined does nothing. */
export type InvalidateInput =
  | 'auto'
  | false
  | ReadonlyArray<LoaderRef<unknown>>;

/**
 * Reads the enclosing `ReloadContext` + `ActiveLoaderIdContext` and returns a
 * stable apply function shared by `useAction` and `<Form>`. Must be called at
 * the top level of a component/hook (it uses `useContext`).
 */
export function useInvalidate(): (invalidate: InvalidateInput | undefined) => void {
  const reloadCtx = useContext(ReloadContext);
  const activeLoaderId = useContext(ActiveLoaderIdContext);
  return useCallback(
    (invalidate) => {
      if (invalidate === 'auto') {
        reloadCtx?.reload();
      } else if (Array.isArray(invalidate)) {
        let invalidatedActive = false;
        for (const ref of invalidate) {
          ref.invalidate();
          if (activeLoaderId && ref.__id === activeLoaderId) {
            invalidatedActive = true;
          }
        }
        // If the user's list includes the active page's loader, re-run it so
        // the visible <Loader> picks up fresh data. Other refs just clear their
        // caches; those pages refetch on their next mount.
        if (invalidatedActive) {
          reloadCtx?.reload();
        }
      }
    },
    [reloadCtx, activeLoaderId]
  );
}
```

- [ ] **Step 4: Run the test; expect PASS.** `pnpm exec vitest run packages/iso/src/__tests__/use-invalidate.test.tsx`

- [ ] **Step 5: Refactor `useAction` onto the hook.** In `packages/iso/src/action.ts`:
  - Add the import: `import { useInvalidate } from './use-invalidate.js';`
  - Remove the two now-unused context reads (currently lines 230-231): `const reloadCtx = useContext(ReloadContext);` and `const activeLoaderId = useContext(ActiveLoaderIdContext);`. Replace them with: `const applyInvalidate = useInvalidate();`
  - Replace the inline invalidate block (currently lines 472-487, the `if (currentOptions?.invalidate === 'auto') { ... } else if (Array.isArray(...)) { ... }`) with a single line: `applyInvalidate(currentOptions?.invalidate);`
  - Remove the now-unused imports `ReloadContext` (from `./reload-context.js`) and `ActiveLoaderIdContext` (from `./internal/contexts.js`) IF nothing else in the file uses them. Verify with `grep -n "ReloadContext\|ActiveLoaderIdContext" packages/iso/src/action.ts` after the edit; if the only remaining references are the (now-removed) import lines, delete those imports. Keep `useContext` in the `preact/hooks` import only if still used elsewhere; otherwise drop it.

- [ ] **Step 6: Run the action tests (refactor parity) + the new hook test.** `pnpm exec vitest run packages/iso/src/__tests__/action.test.tsx packages/iso/src/__tests__/use-invalidate.test.tsx`
Expected: PASS. The three existing `useAction` invalidate tests (`'auto'`, `false`, active-loader-in-array) are the parity check that the extraction preserved behavior.

- [ ] **Step 7: Build + typecheck.** `pnpm --filter @hono-preact/iso build && pnpm typecheck`
Expected: PASS. (If a `Cannot find module '@hono-preact/...'` unrelated error appears, run `pnpm install` and retry.)

- [ ] **Step 8: Commit.**
```bash
git add packages/iso/src/use-invalidate.ts \
  packages/iso/src/__tests__/use-invalidate.test.tsx \
  packages/iso/src/action.ts
git commit -m "refactor(iso): extract useInvalidate hook; useAction shares it

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add the `Form` lifecycle props

**Files:**
- Modify: `packages/iso/src/form.tsx`
- Modify: `packages/iso/src/__tests__/form.test.tsx`

- [ ] **Step 1: Write the lifecycle tests.** Append to `packages/iso/src/__tests__/form.test.tsx` (inside the existing top-level `describe`, after the existing tests). These assume the file's existing `makeStub()` helper and `@testing-library/preact` `render`/`fireEvent`. Add a small fetch stub per test:

```tsx
  it('calls onSuccess with the action data on a success outcome', async () => {
    const stub = makeStub();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ __outcome: 'success', data: { id: 7 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const onSuccess = vi.fn();
    const { getByRole } = render(
      <Form action={stub} onSuccess={onSuccess}>
        <button type="submit">go</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(getByRole('button').closest('form')!);
    });
    expect(onSuccess).toHaveBeenCalledWith({ id: 7 }, expect.objectContaining({
      reset: expect.any(Function),
    }));
  });

  it('calls onError on an error outcome and not on deny', async () => {
    const stub = makeStub();
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ __outcome: 'error', message: 'boom' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    const { getByRole } = render(
      <Form action={stub} onError={onError}>
        <button type="submit">go</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(getByRole('button').closest('form')!);
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe('boom');
  });

  it('resets the form after success when reset is set', async () => {
    const stub = makeStub();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ __outcome: 'success', data: { id: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const { getByRole } = render(
      <Form action={stub} reset>
        <input name="text" defaultValue="" />
        <button type="submit">go</button>
      </Form>
    );
    const input = getByRole('textbox') as HTMLInputElement;
    input.value = 'typed';
    await act(async () => {
      fireEvent.submit(getByRole('button').closest('form')!);
    });
    expect(input.value).toBe('');
  });
```

Add `act` to the existing `@testing-library/preact` import (it currently imports `render, fireEvent, cleanup`; `fireEvent` and `vi` are already imported).

- [ ] **Step 2: Run them; expect FAIL** (the props do not exist yet, so onSuccess/onError are never called and `reset` does nothing). `pnpm exec vitest run packages/iso/src/__tests__/form.test.tsx`

- [ ] **Step 3: Add the props + the reset helper to `form.tsx`.** Three edits:

  (a) Add imports near the top:
```ts
import type { LoaderRef } from './define-loader.js';
import { useInvalidate } from './use-invalidate.js';
```
and add `useRef` to the existing `preact/hooks` import.

  (b) Add a module-level helper above the `Form` function:
```ts
function resetFormFields(formEl: HTMLFormElement, fields?: string[]): void {
  if (!fields) {
    formEl.reset();
    return;
  }
  for (const name of fields) {
    const el = formEl.elements.namedItem(name);
    const nodes =
      el instanceof RadioNodeList ? Array.from(el) : el ? [el] : [];
    for (const node of nodes) {
      if (node instanceof HTMLInputElement) {
        if (node.type === 'checkbox' || node.type === 'radio')
          node.checked = node.defaultChecked;
        else node.value = node.defaultValue;
      } else if (node instanceof HTMLTextAreaElement) {
        node.value = node.defaultValue;
      } else if (node instanceof HTMLSelectElement) {
        for (const opt of Array.from(node.options))
          opt.selected = opt.defaultSelected;
      }
    }
  }
}
```

  (c) Extend `FormProps` and wire the component. Change the `FormProps` type to add the four props:
```ts
export type FormProps<TPayload, TResult> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'action' | 'method' | 'onSubmit' | 'enctype'
> & {
  action: FormActionInput<TPayload, TResult>;
  children?: ComponentChildren;
  onSuccess?: (
    data: TResult,
    helpers: { reset: (fields?: string[]) => void }
  ) => void;
  onError?: (err: Error) => void;
  invalidate?: 'auto' | false | ReadonlyArray<LoaderRef<unknown>>;
  reset?: boolean;
};
```
Then in the component: destructure `onSuccess, onError, invalidate, reset` from props (so they are not spread onto the `<form>` via `...rest`), add `const applyInvalidate = useInvalidate();`, and keep the handlers in a ref so `handleSubmit`'s identity does not churn:
```ts
export function Form<TPayload, TResult>({
  action,
  children,
  onSuccess,
  onError,
  invalidate,
  reset,
  ...rest
}: FormProps<TPayload, TResult>) {
  const [pending, setPending] = useState(false);
  const moduleKey = action.__module;
  const actionName = action.__action;
  const applyInvalidate = useInvalidate();
  const lifecycle = useRef({ onSuccess, onError, invalidate, reset });
  lifecycle.current = { onSuccess, onError, invalidate, reset };
  // ...existing `optimistic` useMemo unchanged...
```
Inside `handleSubmit`, capture the form element once (it already does: `const formEl = e.currentTarget as HTMLFormElement;`) and add `const resetForm = (fields?: string[]) => resetFormFields(formEl, fields);`. Then extend the outcome switch:
- `case 'success':` after the existing `handle?.settle();` and `setLastActionResult(... 'success' ...)`, add:
```ts
            lifecycle.current.onSuccess?.(decoded.data, { reset: resetForm });
            applyInvalidate(lifecycle.current.invalidate);
            if (lifecycle.current.reset) resetForm();
```
- `case 'error':` after its `setLastActionResult`, add `lifecycle.current.onError?.(new Error(decoded.message));`
- `case 'timeout':` after its `setLastActionResult`, add `lifecycle.current.onError?.(new Error(\`Request timed out after ${decoded.timeoutMs}ms\`));`
- `case 'unknown':` after its `setLastActionResult`, add `lifecycle.current.onError?.(new Error(decoded.message ?? \`Unexpected outcome: ${decoded.outcome ?? 'unknown'}\`));`
- Leave `case 'deny'`, `case 'redirect'`, `case 'malformed'` unchanged.
- In the `catch (err)` block, after the existing `setLastActionResult(... 'error' ...)`, add `lifecycle.current.onError?.(err instanceof Error ? err : new Error(String(err)));`

Finally add `applyInvalidate` to `handleSubmit`'s dependency array (currently `[moduleKey, actionName, optimistic]` becomes `[moduleKey, actionName, optimistic, applyInvalidate]`).

- [ ] **Step 4: Run the Form tests; expect PASS.** `pnpm exec vitest run packages/iso/src/__tests__/form.test.tsx`

- [ ] **Step 5: Build + typecheck.** `pnpm --filter @hono-preact/iso build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/iso/src/form.tsx packages/iso/src/__tests__/form.test.tsx
git commit -m "feat(iso): Form onSuccess/onError/invalidate/reset lifecycle props

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Delete the two site workarounds (dogfood proof)

**Files:**
- Modify: `apps/site/src/pages/demo/project-issues.tsx`
- Modify: `apps/site/src/pages/demo/issue.tsx`

- [ ] **Step 1: Migrate `project-issues.tsx`.** Remove the `lastSeenSuccess` ref and the `useEffect` that watches `result` (lines ~14-22): delete `const lastSeenSuccess = useRef<unknown>(null);` and the entire `useEffect(() => { if (result?.kind === 'success' ...) { ...setShowForm(false); } }, [result]);`. Find the `<Form action={serverActions.createIssue} ...>` in the JSX and add `onSuccess={() => setShowForm(false)}`. Remove the now-unused `result`/`useActionResult`/`useRef`/`useEffect` bindings if nothing else in the file references them (check each: `grep -n "result\|useActionResult\|useRef\|useEffect" apps/site/src/pages/demo/project-issues.tsx`).

- [ ] **Step 2: Migrate `issue.tsx`.** In `CommentsSection`, remove `const [formKey, setFormKey] = useState(0);` and the `useEffect(() => { if (result?.kind === 'success') { setFormKey((k) => k + 1); commentsLoader.invalidate(); } }, [result]);`. Find the comment `<Form action={addComment} key={formKey} ...>` (the form driven by `addComment`): remove the `key={formKey}` prop and add `reset invalidate={[commentsLoader]}`. Keep the `addComment` (the `useOptimisticAction` result) passed as the `action` prop unchanged. Remove the now-unused `result`/`useActionResult`/`useEffect`/`useState` bindings if nothing else uses them (check with grep as above; `useState` may still be used elsewhere in the file).

- [ ] **Step 2.5: Verify no orphan imports.** For each file, confirm `pnpm typecheck` (Step 4) will not fail on an unused import; remove any import that is now unreferenced (e.g. `useEffect`, `useRef`, `useActionResult` if they were only for the deleted code).

- [ ] **Step 3: Typecheck + build the site.** `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm typecheck && pnpm --filter site build`
Expected: PASS. (Build the framework first so the site resolves the new `Form` props through `dist/`.)

- [ ] **Step 4: Commit.**
```bash
git add apps/site/src/pages/demo/project-issues.tsx apps/site/src/pages/demo/issue.tsx
git commit -m "refactor(site): replace hand-rolled Form success effects with onSuccess/reset/invalidate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Document the Form lifecycle props

**Files:**
- Modify: `apps/site/src/pages/docs/actions.mdx`

- [ ] **Step 1: Add a lifecycle subsection to the `<Form>` documentation.** In `apps/site/src/pages/docs/actions.mdx`, after the existing `### FormData serialization` area (or right after the paragraph describing `<Form>` accepting HTML attributes around line 88), add a `### Form lifecycle` section with a props table and a short example:

````md
### Form lifecycle

`<Form>` accepts optional callbacks that fire after a submission resolves, plus
declarative cache invalidation and form reset:

| Prop         | Type                                                              | Notes                                                                                              |
| ------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `onSuccess`  | `(data, { reset }) => void`                                       | Fires on a successful action. `reset()` clears the form; `reset(names)` clears specific fields.     |
| `onError`    | `(err: Error) => void`                                           | Fires on an error, timeout, or unknown outcome. A `deny` is not an error; read it via `useActionResult`. |
| `invalidate` | `'auto' \| false \| LoaderRef[]`                                  | Same semantics as `useAction`'s `invalidate`: `'auto'` re-runs the active loader; an array clears each (and re-runs the active loader if listed). |
| `reset`      | `boolean`                                                        | Reset the form to its defaults after a successful submit.                                           |

```tsx
<Form
  action={serverActions.createIssue}
  reset
  invalidate="auto"
  onSuccess={() => setShowForm(false)}
>
  <input name="title" />
  <button type="submit">Create</button>
</Form>
```

`reset` calls the form's native reset (restoring uncontrolled fields to their
defaults and firing a `reset` event). Controlled custom fields can subscribe to
that event to reset themselves.
````

- [ ] **Step 2: Verify the docs build + parity.** `pnpm exec vitest run apps/site/src/pages/docs/__tests__` (still green; no page added) and that the MDX parses via `pnpm --filter site build`.
Expected: PASS.

- [ ] **Step 3: Commit.**
```bash
git add apps/site/src/pages/docs/actions.mdx
git commit -m "docs: document Form lifecycle props

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full pre-push verification

**Files:** none.

- [ ] **Step 1: Run the six-step CI mirror in order, each expecting PASS:**
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

- [ ] **Step 2: If `format:check` fails,** `pnpm format`, restage into the relevant commit or a `style:` commit, and re-run from Step 1.

- [ ] **Step 3: Flake note.** If `measure-client-size` times out under load, re-run it in isolation before treating it as real (`pnpm exec vitest run scripts/__tests__/measure-client-size.test.mjs`).

---

## Self-review

- **Spec coverage (Part A + C):** `useInvalidate` extraction + `useAction` refactor (Task 1), the four `Form` props + per-outcome wiring including the `reset(fields?)` helper and the deny-stays-structured rule (Task 2), site migration of both workarounds (Task 3), docs (Task 4). Part B (ui) is a separate PR/plan, correctly out of scope. `useInvalidate` stays internal (not added to the barrel), per the spec.
- **Placeholder scan:** every code step has full code; the site-migration steps reference exact files and grep checks rather than vague "remove the effect." No placeholders.
- **Type/name consistency:** `useInvalidate`/`InvalidateInput` names match across Task 1's hook, its test, and Task 2's `Form` import; the four prop names (`onSuccess`/`onError`/`invalidate`/`reset`) are identical across `FormProps`, the wiring, the tests, and the docs table; `resetFormFields`/`resetForm` are consistently named; the `onError` message strings match the `setLastActionResult` messages they mirror.
