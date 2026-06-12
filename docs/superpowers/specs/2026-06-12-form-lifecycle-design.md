# Form lifecycle primitive (Section C, primitive 1) design

**Date:** 2026-06-12
**Status:** Approved design, pre-implementation
**Source:** Section C (primitive 1, "Form success lifecycle") of `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`. First of the six site-discovered primitives.
**Goal:** Give `Form` the success lifecycle the site hand-rolls twice. `Form` gains `onSuccess`/`onError`/`invalidate`/`reset`, mirroring `useAction`'s existing vocabulary and sharing its invalidation implementation, and the ui `Select`/`Combobox` learn to reset on a form reset. Deletes both site workarounds.

## Scope decisions (locked with user)

1. **`Form` matches `useAction`'s lifecycle, plus `reset`.** `onSuccess`/`onError`/`invalidate` use the same names and the same `invalidate` semantics as `useAction`; `reset` is form-specific. `onMutate`/snapshot threading does NOT apply to `Form` (it gets optimistic via the branded `action` prop).
2. **One invalidation implementation.** The `'auto' | false | LoaderRef[]` logic currently inlined in `useAction` (action.ts:472-487) is extracted into a shared `useInvalidate()` hook; both `useAction` and `Form` call it. This is the review's "one vocabulary, one implementation" point.
3. **`deny` stays a structured result.** `onError` fires only for `error`/`timeout`/`unknown`. `deny` continues to flow to `useActionResult` as a structured outcome (status/message/data) for inline display.
4. **`reset` supports both a declarative prop and an imperative helper.** `reset?: boolean` (auto-reset on success) and a `reset()` helper passed to `onSuccess`, which also accepts field names to reset a subset of native controls.
5. **Custom-field reset uses the native `reset` event, and the ui components opt in.** A full reset calls `formEl.reset()`, which fires the standard cancelable `reset` event; the ui `Select`/`Combobox` listen for it and reset to their `defaultValue`. This spans two packages (Part A iso, Part B ui) but no cross-package code dependency: the ui side keys off the native event, so it works under any form. Builds on the platform, not a bespoke Form-field protocol.
6. **Two PRs.** PR 1 (iso): Form lifecycle + `useInvalidate` + `useAction` refactor + site migration + docs. PR 2 (ui): `Select`/`Combobox` form-reset participation + docs. PR 2 is independent (native reset events), so it can land before or after PR 1.

## Part A (PR 1), iso: `Form` lifecycle + shared invalidation

### A1. Extract `useInvalidate()`

`useAction` today reads `ReloadContext` (`reloadCtx.reload()`) and `ActiveLoaderIdContext` (`activeLoaderId`) and, at action-commit time, runs (action.ts:472-487):
- `'auto'` → `reloadCtx?.reload()`.
- array → `ref.invalidate()` for each; if any ref's `__id === activeLoaderId`, also `reloadCtx?.reload()`.
- `false`/absent → nothing.

New `useInvalidate()` (its own module, e.g. `packages/iso/src/use-invalidate.ts`) reads both contexts and returns a stable `apply(invalidate: 'auto' | false | ReadonlyArray<LoaderRef<unknown>>) => void` containing that exact logic. `useAction` is refactored to `const applyInvalidate = useInvalidate()` and calls `applyInvalidate(currentOptions.invalidate)` where it currently inlines lines 472-487. Behavior is unchanged (the existing `useAction` invalidate tests are the parity check). `useInvalidate` is not exported from the public barrel in this PR (it is an internal shared core; `Form`/`useAction` consume it within iso). Exporting it publicly is a separate decision (it would need a docs page).

### A2. `Form` API additions

`FormProps<TPayload, TResult>` (form.tsx:25) gains:

```ts
onSuccess?: (data: TResult, helpers: { reset: (fields?: string[]) => void }) => void;
onError?: (err: Error) => void;
invalidate?: 'auto' | false | ReadonlyArray<LoaderRef<unknown>>;
reset?: boolean;
```

The four are destructured in the component and the callbacks are kept in refs (read at submit time) so changing handler identity does not need to re-create `handleSubmit`. `Form` calls `const applyInvalidate = useInvalidate()` at the top.

A `resetForm(fields?: string[])` closure over the submit's `formEl`:
- no args → `formEl.reset()` (full native reset; restores uncontrolled controls to defaults and fires the cancelable `reset` event).
- with names → for each name, restore that named control to its default (`input.value = input.defaultValue` / `input.checked = input.defaultChecked`; `select.selectedIndex` per `option.defaultSelected`; `textarea.value = textarea.defaultValue`), via `formEl.elements.namedItem(name)`. No event (partial reset has no platform signal).

Per-outcome wiring inside `handleSubmit` (additive; the existing `setLastActionResult`/optimistic settle/revert behavior is unchanged):
- **`success`**: after `handle?.settle()` + `setLastActionResult(... 'success' ...)`, call `onSuccess?.(decoded.data, { reset: resetForm })`, then `applyInvalidate(invalidate)`, then if `reset === true` call `resetForm()`.
- **`error` / `timeout` / `unknown`**: after the existing `setLastActionResult(... 'error' ...)`, call `onError?.(new Error(message))` (the same message string the result already carries).
- **`deny`**: unchanged (structured result only, no callback).
- **`redirect`** (navigates) and **`malformed`** (reloads): unchanged, no callbacks.
- **catch block** (network/throw): call `onError?.(err as Error)` alongside the existing error result.

### A3. Site migration (PR 1)

- `apps/site/src/pages/demo/project-issues.tsx`: remove `lastSeenSuccess` ref + the success `useEffect`; pass `onSuccess={() => setShowForm(false)}` to `<Form>`. Drop the now-unused `useActionResult`/`useRef` imports if nothing else uses them.
- `apps/site/src/pages/demo/issue.tsx`: remove `formKey` state + the success `useEffect`; change the comment `<Form>` to `<Form reset invalidate={[commentsLoader]} ...>` and drop the `key={formKey}` remount. Keep the optimistic wiring (the branded `action` prop) intact.

## Part B (PR 2), ui: `Select`/`Combobox` form-reset participation

Both roots already use `useControllableState({ value, defaultValue: defaultValue ?? empty, onChange })` (select.tsx:77, combobox.tsx:93), so `setValue` works controlled or uncontrolled and `defaultValue` is the natural reset target (mirroring native: a native control resets to its `defaultValue`).

Add to each root (a small internal effect, e.g. a shared `useFormReset(ref, onReset)` helper in ui):
- On mount, resolve the enclosing form via a ref on the root/trigger element: `el.closest('form')`. If none, do nothing.
- Add a `reset` listener on that form. On the event, if `!event.defaultPrevented`, call `setValue(defaultValue ?? empty)`. Combobox additionally resets `inputValue` to `defaultInputValue ?? ''`.
- Remove the listener on unmount / when the form ref changes.

This makes a `Select`/`Combobox` reset to its default on any form reset (our `<Form reset>`, a native reset button, etc.), the same way native fields do. No dependency on iso.

## Docs

- **PR 1:** the actions / `Form` docs gain the four lifecycle props (a `Form` props table). If `/docs/optimistic-ui` shows the success-effect pattern, update it to the new props. Follow the `add-docs-page` skill conventions; no new page is strictly required if `Form` is documented on an existing page, but a props table is.
- **PR 2:** a short "Form reset" note on the Select and Combobox pages (resets to `defaultValue` on form reset; respects `preventDefault`).

## Tests

- **PR 1:**
  - `useInvalidate` units: `'auto'` calls `reload`; `false`/absent does nothing; array calls each `ref.invalidate()`; array including the active loader also calls `reload`.
  - `useAction` existing invalidate tests stay green (refactor parity).
  - `Form`: `onSuccess` fires with `decoded.data` on success; `onError` fires (with the right message) on an error outcome and NOT on `deny`; `invalidate` is applied; `reset` prop clears an uncontrolled field after success; the `reset` helper resets named fields.
- **PR 2:**
  - `Select`/`Combobox`: dispatching a `reset` event on the enclosing form resets the value to `defaultValue` (uncontrolled) and fires `onValueChange(defaultValue)` (controlled); a `preventDefault`ed reset does not reset; Combobox also clears its input text.

## Breaking changes

None. All `Form` additions are optional props; the existing result-store behavior is untouched. The `useAction` change is an internal refactor with identical behavior. The ui change is additive (new event listener). Recorded in the next release notes only as new features.

## Out of scope (deferred)

- Exporting `useInvalidate` as a public primitive (it stays an internal shared core; promote later with a docs page if a consumer wants it).
- A bespoke Form-field reset registration protocol (the native `reset` event covers custom-field participation).
- The other five Section C primitives (each its own spec).
