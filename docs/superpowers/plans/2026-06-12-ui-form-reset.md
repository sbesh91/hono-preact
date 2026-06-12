# Form-reset participation for Select/Combobox (Form lifecycle PR 2: ui) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@hono-preact/ui` `Select` and `Combobox` reset to their `defaultValue` when their enclosing `<form>` is reset, via the native `reset` event, so they participate in form reset like native fields (and like the `Form` `reset` from PR 1).

**Architecture:** A small generic `useFormReset(ref, onReset)` hook resolves the enclosing form (`ref.current?.closest('form')`), listens for the native cancelable `reset` event, and calls `onReset` unless the event was `defaultPrevented`. `Select` and `Combobox` each call it with their existing in-flow ref and reset their `useControllableState` value (Combobox also its input text) to the `defaultValue`. Keys off the native event, so it works under any form, with no dependency on iso.

**Tech Stack:** TypeScript, preact, Vitest + `@testing-library/preact` (happy-dom).

**Source spec:** `docs/superpowers/specs/2026-06-12-form-lifecycle-design.md` (Part B). PR 1 (iso `Form` lifecycle) is already merged.

**Conventions:**
- Run a single test file with `pnpm exec vitest run <path>` from the repo root.
- No em-dashes in code/comments/commit messages.
- Commit after each task; messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.
- Run `pnpm format` before the pre-push step (the test/source files must be prettier-clean; `.mdx` is checked too).

## Context the implementer needs

- `SelectRoot` (`packages/ui/src/select/select.tsx`) holds `const [value, setValue] = useControllableState({ value: valueProp, defaultValue: defaultValue ?? emptyDefault, onChange: (v) => v !== undefined && onValueChange?.(v) })` with `const emptyDefault = (multiple ? [] : undefined) as ...`. It has an in-flow `anchorRef = useRef<HTMLElement>(null)` (the trigger).
- `ComboboxRoot` (`packages/ui/src/combobox/combobox.tsx`) has the same `value`/`setValue`/`emptyDefault`, plus `const [inputValue, setInputValue] = useControllableState({ value: inputValueProp, defaultValue: defaultInputValue ?? '', onChange: onInputChange })`, and an in-flow `inputRef = useRef<HTMLInputElement>(null)` (the combobox input).
- The `onChange: (v) => v !== undefined && onValueChange?.(v)` guard means a reset to `undefined` (single-select with no `defaultValue`) updates internal state in uncontrolled mode but does not fire `onValueChange`. So the value-reset tests use a `defaultValue` (controlled-with-default), where the reset target is a defined value and `onValueChange` fires.

## File map

- **Create** `packages/ui/src/use-form-reset.ts`: the generic hook.
- **Create** `packages/ui/src/__tests__/use-form-reset.test.tsx`: its unit tests.
- **Modify** `packages/ui/src/select/select.tsx`: call `useFormReset`.
- **Modify** `packages/ui/src/combobox/combobox.tsx`: call `useFormReset` (value + input text).
- **Modify** `packages/ui/src/__tests__/select-form.test.tsx`: Select reset tests.
- **Create** `packages/ui/src/__tests__/combobox-form-reset.test.tsx`: Combobox reset test.
- **Modify** `apps/site/src/pages/docs/components/select.mdx` + `combobox.mdx`: a "Form reset" note.

---

## Task 1: The `useFormReset` hook

**Files:**
- Create: `packages/ui/src/use-form-reset.ts`
- Create: `packages/ui/src/__tests__/use-form-reset.test.tsx`

- [ ] **Step 1: Write the unit tests.** Create `packages/ui/src/__tests__/use-form-reset.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useFormReset } from '../use-form-reset.js';

afterEach(cleanup);

function Field({ onReset }: { onReset: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useFormReset(ref, onReset);
  return <input ref={ref} name="x" />;
}

describe('useFormReset', () => {
  it('calls onReset when the enclosing form is reset', () => {
    const onReset = vi.fn();
    const { container } = render(
      <form>
        <Field onReset={onReset} />
      </form>
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('does not call onReset when the reset is defaultPrevented', () => {
    const onReset = vi.fn();
    const { container } = render(
      <form onReset={(e) => e.preventDefault()}>
        <Field onReset={onReset} />
      </form>
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onReset).not.toHaveBeenCalled();
  });

  it('does nothing when there is no enclosing form', () => {
    const onReset = vi.fn();
    expect(() => render(<Field onReset={onReset} />)).not.toThrow();
    expect(onReset).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** (cannot resolve `../use-form-reset.js`). `pnpm exec vitest run packages/ui/src/__tests__/use-form-reset.test.tsx`

- [ ] **Step 3: Create the hook.** Create `packages/ui/src/use-form-reset.ts`:

```ts
import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * Resets a controlled field when its enclosing `<form>` is reset. On mount,
 * resolves the form via `ref.current?.closest('form')` and listens for the
 * native cancelable `reset` event; on reset (unless `defaultPrevented`) calls
 * `onReset`. `onReset` is read through a ref so a changing handler identity
 * does not resubscribe the listener. Generic over the element type so a
 * `RefObject<HTMLInputElement>` (or any `HTMLElement` ref) passes without a
 * cast.
 */
export function useFormReset<T extends HTMLElement>(
  ref: RefObject<T>,
  onReset: () => void
): void {
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const handler = (e: Event) => {
      if (!e.defaultPrevented) onResetRef.current();
    };
    form.addEventListener('reset', handler);
    return () => form.removeEventListener('reset', handler);
  }, [ref]);
}
```

- [ ] **Step 4: Run the test; expect PASS** (3 tests). `pnpm exec vitest run packages/ui/src/__tests__/use-form-reset.test.tsx`

- [ ] **Step 5: Build + typecheck.** `pnpm --filter @hono-preact/ui build && pnpm typecheck`
Expected: PASS. (If a `Cannot find module '@hono-preact/...'` unrelated error appears, run `pnpm install` and retry.)

- [ ] **Step 6: Commit.**
```bash
git add packages/ui/src/use-form-reset.ts packages/ui/src/__tests__/use-form-reset.test.tsx
git commit -m "feat(ui): useFormReset hook (reset a controlled field on native form reset)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Note: `useFormReset` stays internal, not added to `packages/ui/src/index.ts`; it is wiring for the components, consistent with the spec keeping new shared cores internal until a consumer needs them publicly.)

---

## Task 2: Wire `Select`

**Files:**
- Modify: `packages/ui/src/select/select.tsx`
- Modify: `packages/ui/src/__tests__/select-form.test.tsx`

- [ ] **Step 1: Write the Select reset tests.** Append to `packages/ui/src/__tests__/select-form.test.tsx` (inside the existing `describe('Select form field', ...)`). Add `vi` to the `vitest` import and `fireEvent` to the `@testing-library/preact` import.

```tsx
  it('resets to defaultValue when the enclosing form is reset', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <form>
        <SelectRoot
          name="fruit"
          value="cherry"
          defaultValue="banana"
          onValueChange={onValueChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="x" />
          </SelectTrigger>
          <SelectPositioner>
            <SelectPopup aria-label="f">
              <SelectOption value="banana">Banana</SelectOption>
              <SelectOption value="cherry">Cherry</SelectOption>
            </SelectPopup>
          </SelectPositioner>
        </SelectRoot>
      </form>
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onValueChange).toHaveBeenCalledWith('banana');
  });

  it('does not reset when the form reset is defaultPrevented', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <form onReset={(e) => e.preventDefault()}>
        <SelectRoot
          name="fruit"
          value="cherry"
          defaultValue="banana"
          onValueChange={onValueChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="x" />
          </SelectTrigger>
          <SelectPositioner>
            <SelectPopup aria-label="f">
              <SelectOption value="banana">Banana</SelectOption>
              <SelectOption value="cherry">Cherry</SelectOption>
            </SelectPopup>
          </SelectPositioner>
        </SelectRoot>
      </form>
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onValueChange).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them; expect FAIL** (Select does not reset yet). `pnpm exec vitest run packages/ui/src/__tests__/select-form.test.tsx`

- [ ] **Step 3: Wire `Select`.** In `packages/ui/src/select/select.tsx`:
  - Add `import { useFormReset } from '../use-form-reset.js';`
  - After the `value`/`setValue` `useControllableState` block and the `anchorRef` declaration (anywhere in the component body before the `return`, with the other hook calls), add:
```ts
  useFormReset(anchorRef, () => setValue(defaultValue ?? emptyDefault));
```
  (`anchorRef`, `setValue`, `defaultValue`, and `emptyDefault` are all already in scope.)

- [ ] **Step 4: Run the Select tests; expect PASS.** `pnpm exec vitest run packages/ui/src/__tests__/select-form.test.tsx`

- [ ] **Step 5: Run the full Select suite (no regressions).** `pnpm exec vitest run packages/ui/src/__tests__/select-form.test.tsx packages/ui/src/__tests__/select-nav.test.tsx packages/ui/src/__tests__/select-presence.test.tsx`
Expected: PASS.

- [ ] **Step 6: Build + typecheck.** `pnpm --filter @hono-preact/ui build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
git add packages/ui/src/select/select.tsx packages/ui/src/__tests__/select-form.test.tsx
git commit -m "feat(ui): Select resets to defaultValue on native form reset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire `Combobox`

**Files:**
- Modify: `packages/ui/src/combobox/combobox.tsx`
- Create: `packages/ui/src/__tests__/combobox-form-reset.test.tsx`

- [ ] **Step 1: Write the Combobox reset test.** Create `packages/ui/src/__tests__/combobox-form-reset.test.tsx`. IMPORTANT: render a MINIMAL tree (Root + Input only, no Positioner/Popup). The form-reset listener only needs the `ComboboxInput` element in the DOM (for `inputRef.closest('form')`); the Popup/Positioner require the Popover API that happy-dom lacks, and `combobox-root.test.tsx` deliberately avoids rendering them. Read `combobox-root.test.tsx` first to confirm the import paths and whether `ComboboxInput` must be wrapped in `ComboboxAnchor` (it renders the visible `input[role="combobox"]`). The test:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { ComboboxRoot, ComboboxInput } from '../combobox/combobox.js';

afterEach(cleanup);

function FruitCombobox(props: {
  onValueChange: (v: string | string[]) => void;
}) {
  return (
    <form>
      <ComboboxRoot
        name="fruit"
        value="cherry"
        defaultValue="banana"
        defaultInputValue=""
        onValueChange={props.onValueChange}
      >
        <ComboboxInput />
      </ComboboxRoot>
    </form>
  );
}

describe('Combobox form reset', () => {
  it('resets value to defaultValue on form reset', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <FruitCombobox onValueChange={onValueChange} />
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onValueChange).toHaveBeenCalledWith('banana');
  });

  it('resets the input text to its default on form reset', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <FruitCombobox onValueChange={onValueChange} />
    );
    const input = container.querySelector(
      'input[role="combobox"]'
    ) as HTMLInputElement;
    input.value = 'che';
    fireEvent.reset(container.querySelector('form')!);
    expect(input.value).toBe('');
  });
});
```

If `ComboboxInput` requires a `ComboboxAnchor` wrapper to render (check `combobox.tsx`), add it (`import { ComboboxAnchor }` and wrap `<ComboboxInput />`), but still omit `ComboboxPositioner`/`ComboboxPopup`. If the visible input does not match `input[role="combobox"]`, adjust the selector to match what `ComboboxInput` actually renders (confirmed in `combobox.tsx` it sets `role: 'combobox'`).

- [ ] **Step 2: Run it; expect FAIL** (Combobox does not reset yet). `pnpm exec vitest run packages/ui/src/__tests__/combobox-form-reset.test.tsx`

- [ ] **Step 3: Wire `Combobox`.** In `packages/ui/src/combobox/combobox.tsx`:
  - Add `import { useFormReset } from '../use-form-reset.js';`
  - After the `value`/`setValue` and `inputValue`/`setInputValue` `useControllableState` blocks and the `inputRef` declaration (with the other hook calls, before `return`), add:
```ts
  useFormReset(inputRef, () => {
    setValue(defaultValue ?? emptyDefault);
    setInputValue(defaultInputValue ?? '');
  });
```
  (`inputRef`, `setValue`, `setInputValue`, `defaultValue`, `emptyDefault`, and `defaultInputValue` are all already in scope.)

- [ ] **Step 4: Run the Combobox reset test + the existing combobox root test; expect PASS.** `pnpm exec vitest run packages/ui/src/__tests__/combobox-form-reset.test.tsx packages/ui/src/__tests__/combobox-root.test.tsx`
Expected: PASS.

- [ ] **Step 5: Build + typecheck.** `pnpm --filter @hono-preact/ui build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/ui/src/combobox/combobox.tsx packages/ui/src/__tests__/combobox-form-reset.test.tsx
git commit -m "feat(ui): Combobox resets value + input text on native form reset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Document the form-reset behavior

**Files:**
- Modify: `apps/site/src/pages/docs/components/select.mdx`
- Modify: `apps/site/src/pages/docs/components/combobox.mdx`

- [ ] **Step 1: Add a short note to each page.** In each of `select.mdx` and `combobox.mdx`, find a sensible spot (near the form-field / `name` documentation, or at the end of a usage section) and add a `### Form reset` subsection:

```md
### Form reset

Inside a `<form>`, the component resets to its `defaultValue` when the form is
reset (a reset button, or `Form`'s `reset`), the same way a native field resets
to its default. A reset whose event is `preventDefault`ed is ignored.
```

For `combobox.mdx`, change the second sentence to also mention the input text: append " The input text returns to `defaultInputValue`." to the note.

- [ ] **Step 2: Verify docs parse + parity + prettier.** Run `pnpm exec vitest run apps/site/src/pages/docs/__tests__` (parity, still green) and `pnpm --filter site build`. Then `pnpm exec prettier --check apps/site/src/pages/docs/components/select.mdx apps/site/src/pages/docs/components/combobox.mdx`; if flagged, `pnpm exec prettier --write` them and re-check.
Expected: all PASS.

- [ ] **Step 3: Commit.**
```bash
git add apps/site/src/pages/docs/components/select.mdx apps/site/src/pages/docs/components/combobox.mdx
git commit -m "docs(ui): note Select/Combobox form-reset behavior

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

- [ ] **Step 3: Flake note.** If `measure-client-size` times out under load, re-run it in isolation (`pnpm exec vitest run scripts/__tests__/measure-client-size.test.mjs`) before treating it as real.

---

## Self-review

- **Spec coverage (Part B):** the `useFormReset` hook (Task 1) resolves the enclosing form, listens for the cancelable `reset` event, and respects `defaultPrevented`; `Select` (Task 2) and `Combobox` (Task 3) reset to `defaultValue` (Combobox also `defaultInputValue`); docs (Task 4). Independent of iso (native event). All present.
- **Placeholder scan:** every code step has full code; the Combobox test step names a concrete model file (`combobox-root.test.tsx`) to match part names against rather than guessing. No placeholders.
- **Type/name consistency:** `useFormReset` is generic `<T extends HTMLElement>`, so `Select`'s `anchorRef` (`RefObject<HTMLElement>`) and `Combobox`'s `inputRef` (`RefObject<HTMLInputElement>`) both pass with no cast; the reset targets (`defaultValue ?? emptyDefault`, `defaultInputValue ?? ''`) match the components' own `useControllableState` defaults exactly.
