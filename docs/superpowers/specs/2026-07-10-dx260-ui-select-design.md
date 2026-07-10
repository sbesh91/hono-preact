> DECISION (maintainer, 2026-07-10): Option 1, discriminated props + null. Single emits Value | null (null = controlled-empty), multi emits Value[]; MenuRadioGroup<V extends string>. Ships as breaking hono-preact-ui 0.3.0 on its own release train.

# Design brief: Select/Combobox value typing over `multiple` + observable clear (issue #260, finding 5)

Track: `ui-select`. Investigated on worktree `origin/main @ 93e480b6`
(`.claude/worktrees/dx260-ui-select`). All file:line anchors below were read on that tree.

---

## 1. Problem statement (verified anchors)

1. **The callback type ignores `multiple`.** `SelectionProps<Value>` declares
   `onValueChange?: (value: Value | Value[]) => void` and `value?: Value | Value[]`
   unconditionally (`packages/ui/src/listbox/selection.ts:17-22`). Both
   `SelectRootProps` (`packages/ui/src/select/select.tsx:28-29`) and
   `ComboboxRootProps` (`packages/ui/src/combobox/combobox.tsx:41-42`) extend it. So a
   single-select consumer is typed as if it could receive an array, and every consumer
   performs an `Array.isArray` dance:
   - `apps/site/src/components/demo/pickers.tsx:50` (StatusSelect), `:81`
     (PrioritySelect), `:132` (AssigneeCombobox)
   - `apps/site/src/components/docs/SelectDemo.tsx:12`
   - `apps/site/src/components/docs/SelectMultiDemo.tsx:12` (the inverse dance:
     `Array.isArray(v) ? v : [v]` in a component that can only ever receive arrays)
   - `apps/site/src/components/docs/ComboboxCreatableDemo.tsx:19`

2. **A cleared single-select is unobservable.** `undefined` doubles as "uncontrolled"
   (`packages/ui/src/use-controllable-state.ts:20`, `isControlled = value !== undefined`),
   so `undefined` can never be emitted as a value. Both Roots swallow it:
   `onChange: (v) => v !== undefined && onValueChange?.(v)`
   (`select.tsx:72`, `combobox.tsx:97`). `Combobox.Clear`'s `clear()` therefore needs a
   lying cast to even call the setter:
   `setValue((multiple ? [] : undefined) as Value | Value[])` (`combobox.tsx:162`), and in
   single mode the resulting `undefined` is silently dropped: a controlled parent never
   learns the user cleared the field. The same swallow hides form resets
   (`useFormReset` -> `setValue(defaultValue ?? emptyDefault)`, `select.tsx:100`,
   `combobox.tsx:111-114`) when `defaultValue` is unset. A sibling lying cast seeds the
   empty default: `(multiple ? [] : undefined) as Value | Value[] | undefined`
   (`select.tsx:65-68`, `combobox.tsx:90-93`).

3. **The site invents a sentinel because controlled-empty is unrepresentable.**
   `AssigneeCombobox` (`pickers.tsx:110-158`) has domain type `value: string | null`, but
   since `null`/empty cannot be passed to `Combobox.Root`, it maps `null -> ''`
   (`value={value ?? ''}`, `pickers.tsx:130`), injects a synthetic
   `{ id: '', name: 'Unassigned' }` option (`pickers.tsx:120`), and decodes on the way out
   (`onChange(id || null)`, `pickers.tsx:133`).

4. **Fold-in: `MenuRadioGroup` is not generic.** `MenuRadioGroupProps` hard-codes
   `value?: string; onValueChange?: (value: string) => void`
   (`packages/ui/src/menu/menu.tsx:367-373`), so `TaskActions.tsx` casts on every
   change: `{ status: v as TaskStatus }` (`apps/site/src/components/demo/TaskActions.tsx:45`)
   and `{ priority: v as TaskPriority }` (`TaskActions.tsx:61-63`), against the repo's
   no-inline-cast policy (root `CLAUDE.md`, "Type casts").

## 2. Mechanism today

- **One shared props/hook pair.** `SelectionProps<Value>` + `useListboxSelection<Value>`
  (`listbox/selection.ts`) are shared by `Select.Root` and `Combobox.Root`. The hook takes
  `value: Value | Value[] | undefined` and normalizes internally via `valuesArray()`
  (`selection.ts:85-88`: `undefined -> []`, scalar -> `[v]`). `toggle` branches on
  `multiple` and calls `setValue(next as Value[])` or `setValue(optionValue as Value)`
  (`selection.ts:150-165`).
- **Contexts erase the generic.** `SelectContextValue` types `isSelected`/`toggle`/
  `registerOption` over `unknown` with an explicit comment that "a Preact context cannot
  carry a per-instance generic; the public Root/Option props re-apply the generic"
  (`select/context.ts:6-18`). The one part that *outputs* values, `Combobox.Value`,
  re-applies the generic with a single documented seam cast:
  `ctx.selectedItems() as OptionEntry<Value>[]` (`combobox.tsx:846-848`). This is the
  package's established pattern for generics-over-context; the redesign must not add
  seams beyond this convention.
- **Value display parts don't touch `Value`.** `Select.Value` consumes
  `selectedLabels(): string[]` only (`select.tsx:248-264`); typeahead matches DOM text via
  `useListNavigation`, not values (`select.tsx:166-175`); hidden form fields serialize
  through `serializeValue`/`String` (`selection.ts:184-195`). So the reshape is confined to
  the two Roots + the hook; no display/typeahead/positioning part changes.
- **Controlled/uncontrolled.** `useControllableState` treats `value !== undefined` as
  controlled (`use-controllable-state.ts:20,34`); this is load-bearing and unchanged in
  every option below.
- **Public surface.** `SelectionProps`, `UseListboxSelectionOptions`, `ListboxSelection`,
  `OptionEntry`, and `useListboxSelection` itself are exported from the package root
  (`packages/ui/src/index.ts:189-195`) and `useListboxSelection` has its own docs page with
  a live example (`apps/site/src/pages/docs/components/use-listbox-selection.mdx`,
  `apps/site/src/components/docs/UseListboxSelectionExample.tsx:44` holds
  `string | string[] | undefined` state).
- `tsconfig.json` has `strict: true`, no `noUncheckedIndexedAccess` (checked root
  `tsconfig.json:13`); `pnpm test:types` picks up
  `packages/**/src/**/__tests__/**/*.test-d.{ts,tsx}` (`vitest.config.ts:109`), and
  `packages/ui` currently has **zero** `.test-d` files (verified by `find`).

## 3. Options

### Option 1 — Discriminated Root props over `multiple`, `null` = cleared-controlled (issue-prescribed)

**Type shape** (`packages/ui/src/listbox/selection.ts`):

```ts
export interface SingleSelectionProps<Value> {
  multiple?: false;
  /** Controlled value; `null` = controlled-and-empty; omit for uncontrolled. */
  value?: Value | null;
  defaultValue?: Value | null;
  onValueChange?: (value: Value | null) => void;
}

export interface MultipleSelectionProps<Value> {
  multiple: true;
  value?: readonly Value[];        // controlled; [] = controlled-and-empty
  defaultValue?: readonly Value[];
  onValueChange?: (value: Value[]) => void;
}

export type SelectionProps<Value> =
  | SingleSelectionProps<Value>
  | MultipleSelectionProps<Value>;
```

`undefined` keeps meaning "uncontrolled" in both arms (preserves
`use-controllable-state.ts:20` semantics). `null` never appears in multi (empty array is
already representable). `Value` is documented as non-nullable; optionally enforce with
`Value extends {}` on the Roots (worth doing: it makes `null`-as-empty unambiguous at the
type level, and `= string` default still applies).

**Root props.** `SelectRootProps` can no longer be an `interface extends` (interfaces
cannot extend a union), so it becomes:

```ts
export interface SelectRootOwnProps extends PositioningProps {
  open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void;
  name?: string; disabled?: boolean; required?: boolean;
  loop?: boolean; typeahead?: boolean; children?: ComponentChildren;
}
export type SelectRootProps<Value = string> = SelectRootOwnProps &
  SelectionProps<Value> & {
    isValueEqual?: (a: Value, b: Value) => boolean;
    serializeValue?: (value: Value) => string;
  };
```

(same move for `ComboboxRootProps`, keeping `itemToString`, input props, `onCreate`, etc.
in the own-props interface).

**Internal normalization (this is what deletes the casts).** Destructuring the union
loses the discriminant correlation, so the Roots pass `props` whole to a helper and only
destructure non-selection keys. Internal state becomes uniformly `Value[]`:

```ts
export interface NormalizedSelection<Value> {
  multiple: boolean;
  values: readonly Value[] | undefined;         // undefined = uncontrolled
  defaultValues: readonly Value[];
  onValuesChange: ((next: Value[]) => void) | undefined;
}

export function normalizeSelectionProps<Value>(
  p: SelectionProps<Value>
): NormalizedSelection<Value> {
  if (p.multiple) {
    const cb = p.onValueChange;
    return {
      multiple: true,
      values: p.value,
      defaultValues: p.defaultValue ?? [],
      onValuesChange: cb === undefined ? undefined : (next) => cb(next),
    };
  }
  const cb = p.onValueChange;
  return {
    multiple: false,
    values:
      p.value === undefined ? undefined : p.value === null ? [] : [p.value],
    defaultValues: p.defaultValue == null ? [] : [p.defaultValue],
    onValuesChange:
      cb === undefined ? undefined : (next) => cb(next.length > 0 ? next[0] : null),
  };
}
```

Narrowing on `p.multiple` discriminates the union (truthy check excludes
`multiple?: false`); no casts, no non-null assertions. The Root then runs
`useControllableState<readonly Value[]>` with `value: norm.values`,
`defaultValue: norm.defaultValues`, `onChange: norm.onValuesChange` — the
`v !== undefined &&` swallow (`select.tsx:72`, `combobox.tsx:97`) is deleted; the
`emptyDefault` casts (`select.tsx:65-68`, `combobox.tsx:90-93`) are deleted;
`clear()` becomes `setValues([])` with no cast (`combobox.tsx:161-165`), and in single
mode that emits `onValueChange(null)` — the cleared single-select is now observable.
Memoize the normalization on `[p.multiple, p.value, p.defaultValue, p.onValueChange]` so
the fresh `[p.value]` wrapper array doesn't churn downstream callback identities every
render (the ctx memos at `select.tsx:102-144` / `combobox.tsx:175-238` key on them).

**`useListboxSelection` reshape.** Options become `values: readonly Value[]`,
`setValues: (next: Value[]) => void` (replacing `value: Value | Value[] | undefined` +
`setValue`, `selection.ts:25-26`); `valuesArray()` (`selection.ts:85-88`) collapses to a
direct read; `toggle`'s single arm becomes `setValues([optionValue])` — the existing
`optionValue as Value` seam at `selection.ts:160` stays exactly one documented
context-erasure seam (toggle's input arrives as `unknown` from context, same convention
as `combobox.tsx:846-848`; not a new cast). Everything else in the hook
(registry, label cache, `selectedItems`, `hiddenFields`) is untouched.

**`MenuRadioGroup<V extends string = string>`** (`menu/menu.tsx:367-400`):

```ts
export type MenuRadioGroupProps<V extends string = string> = {
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'value'>;

export function MenuRadioGroup<V extends string = string>(
  props: MenuRadioGroupProps<V>
) { ... }
```

`MenuRadioItemProps.value` stays `string` (`V extends string` makes item values
assignable; items compare via the erased group context,
`menu/context.ts:53-59`). Inside the group, the context's
`setValue: (value: string) => void` meets the typed callback at one documented seam
(`onValueChange?.(v as V)` with the same "context erases the per-instance generic"
comment as `combobox.tsx:846-848` and `selection.ts:69-71`). A cast-free alternative
would require registering item values at runtime to build a type predicate; that is
machinery with zero runtime benefit and no precedent in this package. Net casts across
the repo still go down (two die in `TaskActions.tsx`, three die in select/combobox).
`TaskActions.tsx:43-52` becomes cast-free by inference:
`<P.RadioGroup value={task.status} onValueChange={(v) => onPatch(task.id, { status: v })}>`
infers `V = TaskStatus` from `value` (works through `parts: typeof Menu | typeof
ContextMenu` because both namespace entries reference the same `MenuRadioGroup`
function, `menu/index.ts:68`, `context-menu/index.ts:37`).

**Before/after (real site code, `pickers.tsx:40-69`):**

```tsx
// before (pickers.tsx:48-51)
<Select.Root<TaskStatus>
  value={value}
  onValueChange={(v) => onChange(Array.isArray(v) ? (v[0] ?? value) : v)}
>

// after — v: TaskStatus | null; keep-current-on-clear is now an explicit choice
<Select.Root<TaskStatus>
  value={value}
  onValueChange={(v) => onChange(v ?? value)}
>
```

```tsx
// before (SelectMultiDemo.tsx:9-13)
<Select.Root multiple value={value}
  onValueChange={(v) => setValue(Array.isArray(v) ? v : [v])}>
// after — v: string[]
<Select.Root multiple value={value} onValueChange={setValue}>
```

```tsx
// AssigneeCombobox after (pickers.tsx:110-158): domain type flows end-to-end
<Combobox.Root<string>
  value={value}                 // string | null, no `?? ''`
  onValueChange={onChange}      // (id: string | null) => void — exact match
  inputValue={query}
  onInputChange={setQuery}
  itemToString={(id) => options.find((o) => o.id === id)?.name ?? ''}
>
  <Combobox.Input ... />
  <Combobox.Clear aria-label="Unassign">×</Combobox.Clear>
  ...
```

**Does the `''` sentinel / synthetic-option pattern disappear fully?** The sentinel *as a
type workaround* disappears completely: `string | null` is now directly representable as
a controlled value, `value ?? ''` (`pickers.tsx:130`) and `onChange(id || null)`
(`pickers.tsx:133`) go away. The synthetic `{ id: '', name: 'Unassigned' }` *row*
(`pickers.tsx:120`) is a separate product affordance ("pick unassigned from the list");
under the new API it is replaced by `Combobox.Clear` (which now observably emits `null`,
so it actually works for a controlled parent — today it would be swallowed). If the demo
insists on an in-list row, that row still needs some value; recommendation: rewrite the
demo to `Combobox.Clear`, which removes both sentinel and synthetic option and dogfoods
the observable-clear behavior.

**Edge behaviors assessed:**
- *Clear, single, controlled:* `onValueChange(null)` fires; parent decides. Today: silent
  (`combobox.tsx:97` + `:162`).
- *Form reset:* `useFormReset` -> `setValues(norm.defaultValues)` -> emits
  `defaultValue` or `null`/`[]`; today a reset to "no default" is swallowed in single
  mode.
- *Hidden fields when cleared:* `valuesArray()` empty -> no hidden input submitted
  (`selection.ts:184-195` unchanged). Matches native unchecked-checkbox semantics;
  document it. (Today the site's `''` sentinel would have submitted `value=""` if `name`
  were set; the demo sets no `name`, so nothing regresses on the site.)
- *`value={null}` with no explicit generic:* `Value` can't be inferred from `null`; falls
  back to the `string` default. Fine for the common case; docs recommend an explicit
  generic (`<Combobox.Root<string>`) when the initial controlled value is `null` and
  `Value` isn't `string`.
- *Non-literal `multiple` (a `boolean` variable):* the union doesn't discriminate; the
  consumer must branch or pin the mode. No site code does this; note it in the props doc.
- *Controlled/uncontrolled switching:* unchanged; `undefined` still means uncontrolled in
  both arms, `use-controllable-state.ts` untouched.
- *A11y:* zero behavior change. `aria-selected`, `aria-multiselectable`, keyboard
  handling, and `Clear`'s button semantics are driven by the same state
  (`select.tsx:319`, `combobox.tsx:315`, `combobox.tsx:791-812`); only the callback's
  type and firing-on-clear change. WCAG AA posture unchanged.
- *Baseline platform:* pure TypeScript/API change; no new platform features.

**Files changed:** `packages/ui/src/listbox/selection.ts` (union + normalize + hook
options), `select/select.tsx` (Root only), `combobox/combobox.tsx` (Root + `clear`),
`menu/menu.tsx` (RadioGroup generic), `packages/ui/src/index.ts` (+
`SingleSelectionProps`/`MultipleSelectionProps`/`NormalizedSelection` exports),
tests (`listbox-selection`, `select-form`, `combobox-controls`, `combobox-form-reset`,
`combobox-input`, `combobox-value`, `menu-checkable`, `exports`), site
(`pickers.tsx`, `SelectDemo.tsx`, `SelectMultiDemo.tsx`, `ComboboxCreatableDemo.tsx`,
`TaskActions.tsx` — cast deletion only, `UseListboxSelectionExample.tsx`), docs
(`select.mdx:269-276`, `combobox.mdx:353-366`, `use-listbox-selection.mdx:28-55`,
`menu.mdx:284-286`, `context-menu.mdx:278-280`).

### Option 2 — Array-everywhere public API (uniform, no union, no null)

```ts
export interface SelectionProps<Value> {
  multiple?: boolean;
  value?: readonly Value[];        // [] = controlled-and-empty; omit = uncontrolled
  defaultValue?: readonly Value[];
  onValueChange?: (value: Value[]) => void;
}
```

Single mode is "array of max length 1" (analogous to the DOM's `select.selectedOptions`).
Clear emits `[]` in both modes — observable with no `null` sentinel at all. The internal
implementation is nearly free (state is already conceptually an array;
`valuesArray()` and all casts at `select.tsx:65`/`combobox.tsx:90,162` die the same way
as Option 1), and `useListboxSelection`'s reshaped `values`/`setValues` options are the
public shape verbatim.

Usage:

```tsx
// StatusSelect
<Select.Root<TaskStatus>
  value={value === null ? [] : [value]}
  onValueChange={(v) => onChange(v[0] ?? value)}
>
```

The `Array.isArray` dance dies, but the dominant single-select case now wraps on the way
in and unwraps on the way out — the boilerplate moves rather than disappearing, and it
lands on the 90% case. It also diverges from ecosystem convention (Radix, Base UI,
Headless UI all hand single-selects a scalar), which matters for a component library's
first impression. `MenuRadioGroup` generic is identical to Option 1.

### Option 3 — Minimal widen: add `| null`, stop swallowing, keep the unified shape

```ts
export interface SelectionProps<Value> {
  value?: Value | Value[] | null;
  defaultValue?: Value | Value[];
  onValueChange?: (value: Value | Value[] | null) => void;
  multiple?: boolean;
}
```

`null` becomes the cleared-controlled marker; `clear()`/reset emit it instead of being
swallowed at `select.tsx:72`/`combobox.tsx:97`. Smallest diff (two Roots + hook accept
`null`), and `MenuRadioGroup` generic can still ride along. But it does not address the
finding's core complaint: every single-select consumer still writes the
`Array.isArray` dance, now with a third arm for `null`; `SelectDemo.tsx:12` gets *worse*.
The type still promises unions that each mode can never produce. This is the "do less"
baseline, not a fix.

## 4. Tradeoff table

| | Option 1: discriminated + `null` | Option 2: array-everywhere | Option 3: widen with `null` |
|---|---|---|---|
| Kills `Array.isArray` dance (4 site files) | Yes | Yes (replaced by wrap/unwrap) | No (adds a third arm) |
| Observable clear / reset | Yes (`null` / `[]`) | Yes (`[]`) | Yes (`null`) |
| Kills the `''` sentinel type-hack (`pickers.tsx:130,133`) | Yes | Yes (`value={value ? [value] : []}`) | Yes |
| Kills lying casts (`select.tsx:65`, `combobox.tsx:90,162`) | Yes | Yes | Partially (`emptyDefault` cast survives) |
| Single-select ergonomics (dominant case) | Best: scalar in, `Value \| null` out | Worst: wrap/unwrap arrays | Unchanged-bad |
| Ecosystem convention (Radix/Base UI style) | Matches | Diverges | Diverges |
| Implementation complexity | Medium (union + normalize helper; Root props become type aliases) | Low | Lowest |
| Type-error quality for consumers | Good (discriminant pins the arm) | Good (one shape) | Poor (3-way unions) |
| New-cast count | 0 new; 1 pre-existing documented seam gains a twin in MenuRadioGroup (same convention as `combobox.tsx:846`) | same | same |
| `useListboxSelection` public hook | Reshaped to `values`/`setValues` (breaking, simpler) | Same reshape | Widened (messier) |

## 5. Recommendation

**Option 1.** It is the only option that makes the type system state what the component
actually does: single mode emits exactly `Value | null`, multi mode emits exactly
`Value[]`, and the discriminant is the prop that already switches the runtime behavior
(`selection.ts:153`). Every verified pain point resolves structurally rather than by
convention: the four `Array.isArray` call sites reduce to direct handlers, the
`''` sentinel and synthetic option in `pickers.tsx` become unnecessary (replaced by an
observable `Combobox.Clear`), and three lying casts in package code are deleted while
adding zero new cast sites beyond the package's one documented context-erasure seam
pattern. Option 2 is internally elegant but taxes the dominant single-select case and
reads foreign next to every peer library; Option 3 leaves the finding's core complaint in
place. The union-props cost is confined to the two Roots and one pure
`normalizeSelectionProps` helper (modularity over brevity: the helper is independently
unit-testable), and the internal `Value[]`-only state actually *simplifies*
`useListboxSelection`. Ship `MenuRadioGroup<V extends string = string>` in the same
0.3.0 since it is the same "type follows the discriminant/generic" theme and deletes the
two `TaskActions.tsx` casts.

## 6. Breaking-change and docs impact

`hono-preact-ui` is on its own release train at 0.2.0 (`packages/ui/package.json:3`);
this ships as **0.3.0** (breaking accepted per the task brief). Release via
`pnpm release:ui` (`scripts/release-ui.mjs`); no framework version movement.

Breaking (Option 1):
- `SelectionProps<Value>` (publicly exported, `index.ts:193-194`) changes from interface
  to a two-arm union; `SelectRootProps`/`ComboboxRootProps` change from `interface` to
  type aliases (consumers using `declare module` interface merging on these would break;
  no known usage).
- Single-mode `onValueChange` now receives `Value | null` and never `Value[]`; multi
  receives `Value[]` only. Runtime-compatible for existing JS (an `Array.isArray` branch
  just goes dead), type-breaking for TS handlers typed to the old union.
- **Behavioral:** `Combobox.Clear` and form reset now invoke `onValueChange` in single
  mode (previously silent, `combobox.tsx:97,162`; `select.tsx:72,100`). Consumers doing
  side effects in the callback will see new invocations with `null`.
- Multi mode: `defaultValue`/`value` must be arrays (the old type accepted a bare `Value`
  alongside `multiple` — a footgun now excluded); `readonly` accepted (loosening).
- `UseListboxSelectionOptions` (public hook, own docs page): `value: Value | Value[] | undefined`
  / `setValue` become `values: readonly Value[]` / `setValues: (next: Value[]) => void`.
- `MenuRadioGroupProps` gains `<V extends string = string>` — source-compatible for
  existing `string` users (defaulted generic), technically breaking only for code that
  names the props type with zero type arguments in a context requiring exact arity
  (none exists).

Docs to update (all verified to state the old contract):
- `apps/site/src/pages/docs/components/select.mdx:269-276` (Root props table:
  `Value | Value[]` rows) plus multi prose at `:43-47`.
- `apps/site/src/pages/docs/components/combobox.mdx:353-366` (props table), `:72`, `:88`,
  `:107` (creatable note: `onCreate` vs `onValueChange` still holds), `:316` (Escape
  reset wording unchanged).
- `apps/site/src/pages/docs/components/use-listbox-selection.mdx:28-55` (options/return
  tables) + `UseListboxSelectionExample.tsx` (drop `string | string[] | undefined`
  state).
- `apps/site/src/pages/docs/components/menu.mdx:284-286` and `context-menu.mdx:278-280`
  (RadioGroup `value`/`onValueChange` typed over `V`).
- Per repo policy (`feedback_docs_no_migration_breadcrumbs`): docs describe the new
  contract only, no "formerly `Value | Value[]`" breadcrumbs; the migration story goes in
  the 0.3.0 release notes instead.
- `pnpm gen:agents-corpus` must be re-run after the mdx edits (bundled docs corpus gate).

## 7. Testing strategy

Honors the repo's verification constraints: shared-type changes must run full
`pnpm typecheck` (not just `test:types`), and cross-package API changes must run the
consuming suites (`pnpm test:coverage`) — per `feedback_typecheck_for_type_changes` and
`feedback_verify_subagent_test_claims`.

1. **Type-level (new):** add `packages/ui/src/__tests__/selection-props.test-d.tsx`
   (auto-picked-up: `vitest.config.ts:109` globs
   `packages/**/src/**/__tests__/**/*.test-d.{ts,tsx}`; the ui package has none today).
   Assert: (a) single-mode handler param infers `Value | null`; (b) `multiple` handler
   param infers `Value[]`; (c) `multiple value={scalar}` is a type error; (d) omitted
   `multiple` + array `value` is a type error; (e) `MenuRadioGroup` infers `V` from
   `value` and rejects an out-of-union handler; (f) `value={null}` without a generic
   defaults `Value` to `string`. Runs under `pnpm test:types`.
2. **Unit (updated/added):**
   - `listbox-selection.test.tsx`: rewrite harness state to `string[]`
     (`values`/`setValues`); behavior assertions unchanged.
   - `combobox-controls.test.tsx` ("Clear empties the value and input", `:40-55`): add a
     controlled single case asserting `onValueChange` fires with `null` (the new
     observable-clear contract).
   - `combobox-form-reset.test.tsx`: add assertion that reset with no `defaultValue`
     emits `null` in single mode (previously swallowed).
   - `combobox-input.test.tsx:106` (`toHaveBeenLastCalledWith([])`) and
     `combobox-value.test.tsx:50` stay green as-is — good regression canaries that multi
     semantics didn't move.
   - `select-form.test.tsx`: add reset-emits case mirroring combobox.
   - `menu-checkable.test.tsx:41-61`: unchanged (string default); add one typed
     `MenuRadioGroup<'sm' | 'lg'>` render to lock inference at runtime-test level.
   - `exports.test.ts`: add `SingleSelectionProps`/`MultipleSelectionProps` (types are
     erased at runtime; whatever pattern that test uses for type exports today applies).
   - New unit for `normalizeSelectionProps` (pure function: 6 cases —
     controlled/uncontrolled x single/multi, `null`, empty emit mapping).
3. **Site as integration oracle:** the five demo rewrites compile under `pnpm typecheck`
   and `pnpm --filter site build`; manually drive the Assignee combobox clear-to-null
   path in the dev site (per `verify` norms) since MCP cannot assert everything.
4. **Full pre-push CI parity** (all 8 steps in root `CLAUDE.md`), noting step 1 (rebuild
   framework `dist/`) is mandatory before `typecheck` because `apps/site` resolves
   `hono-preact-ui` types through `dist/`.
5. **A11y non-regression:** no ARIA/keyboard change is intended; the existing
   `select-option`, `combobox-popup`, `menu-checkable` assertions on
   `aria-selected`/`aria-multiselectable`/`aria-checked` are the guard. No new axe run
   needed beyond the site's existing checks.
