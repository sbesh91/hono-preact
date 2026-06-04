# @hono-preact/ui Dialog Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the standalone `@hono-preact/ui` package, prove the headless-component architecture end to end with a modal Dialog on the native `<dialog>` element, and extend the client-JS size tracker with a per-component (Section C) table so each component's cost surfaces the moment its `dist` builds.

**Architecture:** A new `packages/ui` workspace package (peer-dep `preact` only) ships four foundational primitives (`useRender`/`mergeRefs`, `useControllableState`, SSR-stable id wiring, the `data-state` contract) and a compound Dialog (`Root/Trigger/Popup/Title/Description/Close`). The Dialog leans on the platform: `<dialog>.showModal()` supplies the focus trap, `inert`, top layer, and Escape; the library owns only ARIA wiring, open-state, and `render`-prop composition. Docs ship a live demo plus copyable CSS/Tailwind examples on a new `/docs/components/dialog` page. The size tracker gains Section C, which bundles `packages/ui/dist` per component (total + marginal over the shared primitives), mirroring Section A's core/feature model.

**Tech Stack:** Preact 10 (`preact`, `preact/hooks`), TypeScript, Vitest + `@testing-library/preact` + happy-dom, `preact-render-to-string` (SSR test), esbuild + `node:zlib` (size measurement), MDX (docs).

---

## Reference: spec and key facts (read before starting)

- Design spec this plan implements: `docs/superpowers/specs/2026-06-01-ui-dialog-slice-design.md`.
- Investigation/rationale: `docs/superpowers/specs/2026-05-31-headless-components-investigation.md`.
- Local precedent for the render prop: `packages/iso/src/internal/use-render.ts` and `merge-refs.ts` (consumed by `packages/iso/src/view-transition-name.ts`). The `@hono-preact/ui` copies own their code (no dependency on `@hono-preact/iso/internal`), and `useRender`'s function form gains a second `state` argument.
- **Nav has moved to the two-area structure (PR #71).** Component docs live under `apps/site/src/pages/docs/components/<slug>.mdx` and serve `/docs/components/<slug>`. The Dialog page is `/docs/components/dialog`, NOT `/docs/dialog` as the older spec text in Section 9 assumed. The Components area landing (`apps/site/src/pages/docs/components/index.mdx`) already frames `Overlays` / `Collections` / `Foundations`; Dialog joins a new `Overlays` nav section.
- **Tests opt into a DOM** with a `// @vitest-environment happy-dom` docblock on line 1. The root `vitest.config.ts` `test.include` is an explicit allowlist; `packages/ui` tests will NOT run until added to it. `vitest.setup.ts` already extends `@testing-library/jest-dom` matchers.
- Preact JSX handler types: `onClick?: JSX.MouseEventHandler<Target>`, where the event is `JSX.TargetedMouseEvent<Target>`.
- The size tracker's CI jobs already build `@hono-preact/*` before measuring (`.github/workflows/ci.yml`, `client-size` and `build-and-tag` jobs), so Section C populates with no workflow changes.

**Type-cast rule (project CLAUDE.md):** prefer reshaping types over `as` casts. The only acceptable casts here are the two the shipped iso `useRender` already uses (`props as JSX.HTMLAttributes`, the internal `Props` reads inside the render abstraction). Do not introduce new casts in component code; type part props as `{ render?; children? } & Omit<JSX.HTMLAttributes<Target>, 'children'>` and destructure handlers so chaining is typed.

**Commit-message footer (every commit in this plan):**

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

No em-dashes in prose, comments, or commit messages.

---

## File structure

**New package `packages/ui/`:**

| File | Responsibility |
|---|---|
| `package.json` | `@hono-preact/ui`, public, `peerDependencies.preact`, `sideEffects:false`, exports `./dist/index.js` |
| `tsconfig.json` | mirrors `packages/iso/tsconfig.json` |
| `README.md` | one-paragraph package intro |
| `src/index.ts` | public barrel (primitives + Dialog) |
| `src/merge-refs.ts` | `mergeRefs` |
| `src/use-render.ts` | `useRender` + `RenderProp` type (function form receives `state`) |
| `src/use-controllable-state.ts` | controlled/uncontrolled state hook with a stable setter |
| `src/dialog/context.ts` | `DialogContext`, `DialogContextValue`, `useDialogContext` |
| `src/dialog/dialog.tsx` | `DialogRoot/Trigger/Popup/Title/Description/Close` + `Dialog` namespace + prop types |
| `src/dialog/index.ts` | re-export of `dialog.tsx` |
| `src/__tests__/*.test.{ts,tsx}` | co-located tests |

**`apps/site`:** `src/components/docs/CopyButton.tsx`, `Example.tsx`, `CodeTabs.tsx`, `DialogDemo.tsx`; `src/pages/docs/components/dialog.mdx`; edits to `src/pages/docs/nav.ts` and `package.json`.

**Repo:** edits to `vitest.config.ts` (test include, alias, coverage), `scripts/client-size-config.mjs`, `scripts/measure-client-size.mjs`, `scripts/render-size-comment.mjs`, the three `scripts/__tests__/*.test.mjs`, `client-size-report.json` (regenerated baseline), and `.claude/skills/add-docs-page.md` (Overlays row).

---

## Task 1: Scaffold the `@hono-preact/ui` package and wire it into test/typecheck/build

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/README.md`
- Create: `packages/ui/src/index.ts`
- Modify: `vitest.config.ts` (add to `resolve.alias`, `test.include`, `test.coverage.include`/`exclude`)

- [ ] **Step 1: Create `packages/ui/package.json`**

```json
{
  "name": "@hono-preact/ui",
  "version": "0.0.0",
  "private": true,
  "description": "Standalone, unstyled, accessible Preact UI primitives for hono-preact.",
  "keywords": [
    "preact",
    "headless",
    "ui",
    "accessible",
    "dialog"
  ],
  "homepage": "https://framework.sbesh.com",
  "bugs": {
    "url": "https://github.com/sbesh91/hono-preact/issues"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/sbesh91/hono-preact.git",
    "directory": "packages/ui"
  },
  "license": "MIT",
  "author": "Steven Beshensky",
  "engines": {
    "node": ">=20"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "prepublishOnly": "tsc"
  },
  "peerDependencies": {
    "preact": ">=10.11.0"
  },
  "devDependencies": {
    "typescript": "*",
    "preact-render-to-string": "^6.6.7"
  },
  "sideEffects": false
}
```

> `version` stays `0.0.0` and the package is `private` + absent from `scripts/release.mjs`; publishing is deferred (spec Section 12). `>=10.11.0` is the SSR-stable `useId` floor. `preact-render-to-string` is a devDep so the SSR test resolves it under strict pnpm.

- [ ] **Step 2: Create `packages/ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "noEmit": false,
    "types": ["@testing-library/jest-dom"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["src/**/__tests__/**"]
}
```

> Mirrors `packages/iso/tsconfig.json` but drops `vite/client` from `types` (ui has no Vite usage and no `vite` devDep). JSX config is inherited from the root tsconfig.

- [ ] **Step 3: Create `packages/ui/README.md`**

```markdown
# @hono-preact/ui

Standalone, unstyled, accessible UI primitives for Preact. Built native to
Preact (no React compat), leaning on the platform: the native `<dialog>`
element and top layer, `inert`, and a thin ARIA, keyboard, and state layer on
top. Style it however you like through the `data-state` contract and the
`render` prop. Part of the hono-preact project; usable in any Preact app.
```

- [ ] **Step 4: Create `packages/ui/src/index.ts` (initial placeholder barrel)**

```ts
// Public barrel for @hono-preact/ui. Primitives and components are exported
// here as they land in subsequent tasks.
export {};
```

- [ ] **Step 5: Wire the package into the root vitest config**

In `vitest.config.ts`, add an alias for the package (so any `apps/site` test that imports the Dialog demo resolves to source), add the test glob to `test.include`, and add the package to coverage.

Add to `resolve.alias` (next to the other `@hono-preact/*` aliases):

```ts
      '@hono-preact/ui': path.resolve(__dirname, 'packages/ui/src/index.ts'),
```

Add to `test.include` (after the `packages/iso/...` entry):

```ts
      'packages/ui/src/**/__tests__/**/*.test.{ts,tsx}',
```

Add to `test.coverage.include`:

```ts
        'packages/ui/src/**/*.{ts,tsx}',
```

Add to `test.coverage.exclude` (alongside the existing `index.ts` exclusions):

```ts
        'packages/ui/src/index.ts',
        'packages/ui/src/dialog/index.ts',
```

- [ ] **Step 6: Install and build the new package**

Run: `pnpm install`
Expected: lockfile updates, `@hono-preact/ui` linked into the workspace, `preact-render-to-string` added under `packages/ui`.

Run: `pnpm --filter @hono-preact/ui build`
Expected: `packages/ui/dist/index.js` and `index.d.ts` emitted, exit 0.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (the empty barrel and new tsconfig typecheck clean).

- [ ] **Step 8: Commit**

```bash
git add packages/ui vitest.config.ts pnpm-lock.yaml
git commit -m "feat(ui): scaffold @hono-preact/ui package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `mergeRefs`

**Files:**
- Create: `packages/ui/src/merge-refs.ts`
- Test: `packages/ui/src/__tests__/merge-refs.test.ts`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/__tests__/merge-refs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeRefs } from '../merge-refs.js';

describe('mergeRefs', () => {
  it('calls function refs with the node', () => {
    let seen: unknown = 'unset';
    const fn = (node: unknown) => {
      seen = node;
    };
    mergeRefs<string>(fn)('hello');
    expect(seen).toBe('hello');
  });

  it('assigns object refs', () => {
    const ref = { current: null as string | null };
    mergeRefs<string>(ref)('world');
    expect(ref.current).toBe('world');
  });

  it('skips null and undefined refs', () => {
    const ref = { current: null as string | null };
    expect(() => mergeRefs<string>(null, undefined, ref)('x')).not.toThrow();
    expect(ref.current).toBe('x');
  });

  it('fans out to every ref', () => {
    const a = { current: null as number | null };
    let b: number | null = null;
    mergeRefs<number>(a, (n) => {
      b = n;
    })(7);
    expect(a.current).toBe(7);
    expect(b).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/ui/src/__tests__/merge-refs.test.ts`
Expected: FAIL (`Cannot find module '../merge-refs.js'`).

- [ ] **Step 3: Write the implementation**

`packages/ui/src/merge-refs.ts`:

```ts
import type { Ref } from 'preact';

type AnyRef<T> = Ref<T> | null | undefined;

// Combine several refs into one callback ref. Function refs are invoked with
// the node; object refs have `.current` assigned; null/undefined are skipped.
export function mergeRefs<T>(...refs: AnyRef<T>[]): (node: T | null) => void {
  return (node: T | null) => {
    for (const ref of refs) {
      if (ref == null) continue;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as { current: T | null }).current = node;
      }
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/ui/src/__tests__/merge-refs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the barrel**

In `packages/ui/src/index.ts`, replace `export {};` with:

```ts
export { mergeRefs } from './merge-refs.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/merge-refs.ts packages/ui/src/__tests__/merge-refs.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add mergeRefs primitive

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `useRender` + `RenderProp`

**Files:**
- Create: `packages/ui/src/use-render.ts`
- Test: `packages/ui/src/__tests__/use-render.test.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/__tests__/use-render.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { h } from 'preact';
import { useRender, type RenderProp } from '../use-render.js';

function Widget(props: {
  render?: RenderProp<{ active: boolean }>;
  active?: boolean;
}) {
  return useRender<{ active: boolean }>({
    render: props.render,
    defaultTag: 'button',
    props: { class: 'fw', 'data-fw': 'yes', type: 'button' },
    state: { active: props.active ?? false },
    children: 'label',
  });
}

describe('useRender', () => {
  it('renders the default tag with framework props and children', () => {
    const { container } = render(<Widget />);
    const el = container.querySelector('button')!;
    expect(el).toBeTruthy();
    expect(el.getAttribute('data-fw')).toBe('yes');
    expect(el.className).toBe('fw');
    expect(el.textContent).toBe('label');
  });

  it('uses a string render as the tag', () => {
    const { container } = render(<Widget render="a" />);
    expect(container.querySelector('a')).toBeTruthy();
    expect(container.querySelector('button')).toBeNull();
  });

  it('merges class and ref when an element is provided as render', () => {
    let refNode: HTMLElement | null = null;
    const { container } = render(
      <Widget
        render={h('span', {
          class: 'user',
          ref: (n: HTMLElement | null) => {
            refNode = n;
          },
        })}
      />
    );
    const el = container.querySelector('span')!;
    expect(el.className).toBe('user fw');
    expect(el.getAttribute('data-fw')).toBe('yes');
    expect(refNode).toBe(el);
  });

  it('calls a function render with merged props and state', () => {
    let receivedState: { active: boolean } | undefined;
    render(
      <Widget
        active
        render={(props, state) => {
          receivedState = state;
          return h('output', props, 'fn');
        }}
      />
    );
    expect(receivedState).toEqual({ active: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/ui/src/__tests__/use-render.test.tsx`
Expected: FAIL (`Cannot find module '../use-render.js'`).

- [ ] **Step 3: Write the implementation**

`packages/ui/src/use-render.ts`:

```ts
import {
  cloneElement,
  h,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import { mergeRefs } from './merge-refs.js';

type Props = Record<string, unknown>;

// A render override for a compound part: a VNode (element to clone), a string
// (tag name), a function called with the merged framework props and the
// part's `state`, or undefined (use the default tag).
export type RenderProp<State = Record<never, never>> =
  | VNode
  | string
  | ((props: Props, state: State) => VNode)
  | undefined;

interface UseRenderOptions<State> {
  render?: RenderProp<State>;
  defaultTag: string;
  props: Props; // framework-controlled props (ref, aria-*, data-*, handlers)
  state?: State; // passed to the function form
  children?: ComponentChildren;
}

function joinClass(a: unknown, b: unknown): string | undefined {
  const parts: string[] = [];
  if (typeof a === 'string' && a.length > 0) parts.push(a);
  if (typeof b === 'string' && b.length > 0) parts.push(b);
  if (parts.length === 0) return undefined;
  return parts.join(' ');
}

// Framework props win over user props, except `class`/`className` (joined) and
// `ref` (merged so both the user ref and our ref fire).
function mergeProps(user: Props, framework: Props): Props {
  const out: Props = { ...user };
  for (const key of Object.keys(framework)) {
    if (key === 'class' || key === 'className') {
      const userClass = (user.class ?? user.className) as unknown;
      const merged = joinClass(userClass, framework[key]);
      if (merged !== undefined) out.class = merged;
      delete out.className;
    } else if (key === 'ref') {
      out.ref = mergeRefs(
        user.ref as Parameters<typeof mergeRefs>[0],
        framework.ref as Parameters<typeof mergeRefs>[0]
      );
    } else {
      out[key] = framework[key];
    }
  }
  return out;
}

export function useRender<State = Record<never, never>>(
  opts: UseRenderOptions<State>
): VNode {
  const { render, defaultTag, props, state, children } = opts;

  if (typeof render === 'function') {
    return render(mergeProps({}, props), state as State);
  }
  if (render && typeof render === 'object' && 'type' in render) {
    const merged = mergeProps((render.props ?? {}) as Props, props);
    const mergedChildren: ComponentChildren =
      children !== undefined
        ? children
        : ((render.props as { children?: ComponentChildren })?.children ??
          null);
    return cloneElement(render, merged, mergedChildren);
  }
  const tag = typeof render === 'string' ? render : defaultTag;
  return h(tag, props as JSX.HTMLAttributes, children) as VNode;
}
```

> The two `as` casts here (`props as JSX.HTMLAttributes`, the internal `Props` reads) are exactly those the shipped iso `useRender` uses; they are the accepted boundary of the render abstraction and are not new casts. The function form intentionally does not forward `children`; a function render supplies its own element and children inline (matches the iso precedent).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/ui/src/__tests__/use-render.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the barrel**

In `packages/ui/src/index.ts`, add:

```ts
export { useRender, type RenderProp } from './use-render.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/use-render.ts packages/ui/src/__tests__/use-render.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add useRender render-prop primitive with state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `useControllableState`

**Files:**
- Create: `packages/ui/src/use-controllable-state.ts`
- Test: `packages/ui/src/__tests__/use-controllable-state.test.ts`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/__tests__/use-controllable-state.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useControllableState } from '../use-controllable-state.js';

describe('useControllableState', () => {
  it('is uncontrolled when value is undefined: setter updates state and calls onChange', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useControllableState<boolean>({ defaultValue: false, onChange })
    );
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is controlled when value is provided: reads value, does not self-update', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useControllableState<boolean>({
        value: true,
        defaultValue: false,
        onChange,
      })
    );
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    // Controlled: internal state is ignored, value stays true until the parent
    // re-renders with a new `value`.
    expect(result.current[0]).toBe(true);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('returns a stable setter across renders', () => {
    const { result, rerender } = renderHook(() =>
      useControllableState<number>({ defaultValue: 0 })
    );
    const first = result.current[1];
    rerender();
    expect(result.current[1]).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/ui/src/__tests__/use-controllable-state.test.ts`
Expected: FAIL (`Cannot find module '../use-controllable-state.js'`).

- [ ] **Step 3: Write the implementation**

`packages/ui/src/use-controllable-state.ts`:

```ts
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

interface UseControllableStateOptions<T> {
  value?: T; // controlled; when defined the component is controlled
  defaultValue: T; // uncontrolled initial value
  onChange?: (value: T) => void;
}

// A controlled/uncontrolled state hook. When `value` is provided the hook is
// controlled (reads `value`, never self-updates; `onChange` is the only way
// out). When absent it is uncontrolled (internal state, seeded from
// `defaultValue`). The setter is stable across renders so effects can depend
// on it without re-subscribing.
export function useControllableState<T>(
  opts: UseControllableStateOptions<T>
): [T, (next: T) => void] {
  const { value, defaultValue, onChange } = opts;
  const isControlled = value !== undefined;

  const [internal, setInternal] = useState<T>(defaultValue);

  // Keep the latest onChange / controlled-ness in refs so the stable setter
  // closes over fresh values without changing identity.
  const onChangeRef = useRef(onChange);
  const isControlledRef = useRef(isControlled);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    isControlledRef.current = isControlled;
  });

  const current = isControlled ? (value as T) : internal;

  const setValue = useCallback((next: T) => {
    if (!isControlledRef.current) setInternal(next);
    onChangeRef.current?.(next);
  }, []);

  return [current, setValue];
}
```

> `value as T` is guarded by `isControlled` (`value !== undefined`); it is the narrowing the `value?: T` signature cannot express on its own and is local to the read. Acceptable per the project rule (the alternative reshape buys nothing here).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/ui/src/__tests__/use-controllable-state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export from the barrel**

In `packages/ui/src/index.ts`, add:

```ts
export { useControllableState } from './use-controllable-state.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/use-controllable-state.ts packages/ui/src/__tests__/use-controllable-state.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add useControllableState primitive

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Dialog context

**Files:**
- Create: `packages/ui/src/dialog/context.ts`
- Test: `packages/ui/src/__tests__/dialog-context.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/__tests__/dialog-context.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { useDialogContext } from '../dialog/context.js';

function Consumer() {
  // Calling outside a provider must throw a clear, named error.
  useDialogContext('Trigger');
  return null;
}

describe('useDialogContext', () => {
  it('throws a part-named error when used outside Dialog.Root', () => {
    expect(() => render(<Consumer />)).toThrow(
      /<Dialog\.Trigger> must be used within <Dialog\.Root>/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/ui/src/__tests__/dialog-context.test.tsx`
Expected: FAIL (`Cannot find module '../dialog/context.js'`).

- [ ] **Step 3: Write the implementation**

`packages/ui/src/dialog/context.ts`:

```ts
import { createContext, type Ref } from 'preact';
import { useContext } from 'preact/hooks';

export interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  dialogRef: Ref<HTMLDialogElement>;
  triggerId: string;
  popupId: string;
  titleId: string;
  descriptionId: string;
  hasDescription: boolean;
  // Description parts register on mount and deregister on unmount; the Popup
  // wires aria-describedby only while at least one is present.
  registerDescription: () => () => void;
}

export const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialogContext(part: string): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error(`<Dialog.${part}> must be used within <Dialog.Root>`);
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/ui/src/__tests__/dialog-context.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/dialog/context.ts packages/ui/src/__tests__/dialog-context.test.tsx
git commit -m "feat(ui): add Dialog context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Dialog Root and Trigger

**Files:**
- Create: `packages/ui/src/dialog/dialog.tsx`
- Test: `packages/ui/src/__tests__/dialog-trigger.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/__tests__/dialog-trigger.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { DialogRoot, DialogTrigger } from '../dialog/dialog.js';

describe('Dialog Root + Trigger', () => {
  it('renders a button trigger with dialog ARIA wiring', () => {
    const { getByText } = render(
      <DialogRoot>
        <DialogTrigger>Open</DialogTrigger>
      </DialogRoot>
    );
    const btn = getByText('Open');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBeTruthy();
    expect(btn.getAttribute('id')).toBeTruthy();
    expect(btn.getAttribute('data-state')).toBe('closed');
  });

  it('opening flips aria-expanded and data-state on the trigger', () => {
    const { getByText } = render(
      <DialogRoot>
        <DialogTrigger>Open</DialogTrigger>
      </DialogRoot>
    );
    const btn = getByText('Open');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('data-state')).toBe('open');
  });

  it('chains a consumer onClick before opening', () => {
    const onClick = vi.fn();
    const { getByText } = render(
      <DialogRoot>
        <DialogTrigger onClick={onClick}>Open</DialogTrigger>
      </DialogRoot>
    );
    fireEvent.click(getByText('Open'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('respects a controlled open prop', () => {
    const { getByText } = render(
      <DialogRoot open>
        <DialogTrigger>Open</DialogTrigger>
      </DialogRoot>
    );
    expect(getByText('Open').getAttribute('aria-expanded')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/ui/src/__tests__/dialog-trigger.test.tsx`
Expected: FAIL (`Cannot find module '../dialog/dialog.js'`).

- [ ] **Step 3: Write the implementation (Root + Trigger; later tasks append to this file)**

`packages/ui/src/dialog/dialog.tsx`:

```tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { DialogContext, useDialogContext } from './context.js';

export interface DialogRootProps {
  open?: boolean; // controlled
  defaultOpen?: boolean; // uncontrolled (default false)
  onOpenChange?: (open: boolean) => void;
  children?: ComponentChildren;
}

export type DialogTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function DialogRoot(props: DialogRootProps): VNode {
  const { open: openProp, defaultOpen, onOpenChange, children } = props;
  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const dialogRef = useRef<HTMLDialogElement>(null);
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const popupId = `${baseId}-popup`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  // Reference-counted description presence so the Popup wires aria-describedby
  // only when a Description is actually rendered.
  const [descriptionCount, setDescriptionCount] = useState(0);
  const registerDescription = useCallback(() => {
    setDescriptionCount((c) => c + 1);
    return () => setDescriptionCount((c) => c - 1);
  }, []);

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      dialogRef,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      hasDescription: descriptionCount > 0,
      registerDescription,
    }),
    [
      open,
      setOpen,
      triggerId,
      popupId,
      titleId,
      descriptionId,
      descriptionCount,
      registerDescription,
    ]
  );

  return h(DialogContext.Provider, { value: ctx }, children);
}

export function DialogTrigger(props: DialogTriggerProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = useDialogContext('Trigger');

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    ctx.setOpen(true);
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': ctx.open,
      'aria-controls': ctx.popupId,
      id: ctx.triggerId,
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
    },
    state: { open: ctx.open },
    children,
  });
}
```

Add the import for `useControllableState` at the top of the file (after the `useRender` import):

```tsx
import { useControllableState } from '../use-controllable-state.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/ui/src/__tests__/dialog-trigger.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/dialog/dialog.tsx packages/ui/src/__tests__/dialog-trigger.test.tsx
git commit -m "feat(ui): add Dialog Root and Trigger

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Dialog Popup

**Files:**
- Modify: `packages/ui/src/dialog/dialog.tsx` (append `DialogPopup`)
- Test: `packages/ui/src/__tests__/dialog-popup.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/__tests__/dialog-popup.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import {
  DialogRoot,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
} from '../dialog/dialog.js';

// happy-dom implements HTMLDialogElement but showModal/close do not toggle the
// top layer; spy on them and drive the `open` property/`close` event manually.
let showModal: ReturnType<typeof vi.spyOn>;
let close: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  showModal = vi
    .spyOn(HTMLDialogElement.prototype, 'showModal')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  close = vi
    .spyOn(HTMLDialogElement.prototype, 'close')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });
});

afterEach(() => {
  showModal.mockRestore();
  close.mockRestore();
});

function Basic(props: { closeOnBackdropClick?: boolean }) {
  return (
    <DialogRoot>
      <DialogTrigger>Open</DialogTrigger>
      <DialogPopup closeOnBackdropClick={props.closeOnBackdropClick}>
        <DialogTitle>Title</DialogTitle>
        <p>Body</p>
      </DialogPopup>
    </DialogRoot>
  );
}

describe('Dialog Popup', () => {
  it('calls showModal when opened and close when closed', () => {
    const { getByText, container } = render(<Basic />);
    fireEvent.click(getByText('Open'));
    expect(showModal).toHaveBeenCalledTimes(1);
    const dialog = container.querySelector('dialog')!;
    expect(dialog.getAttribute('data-state')).toBe('open');
  });

  it('syncs state to closed on the native close event', () => {
    const { getByText, container } = render(<Basic />);
    fireEvent.click(getByText('Open'));
    const dialog = container.querySelector('dialog')!;
    dialog.dispatchEvent(new Event('close'));
    expect(dialog.getAttribute('data-state')).toBe('closed');
  });

  it('wires aria-labelledby to the Title id', () => {
    const { container } = render(<Basic />);
    const dialog = container.querySelector('dialog')!;
    const title = container.querySelector('h2')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('aria-label on the Popup suppresses aria-labelledby', () => {
    const { container } = render(
      <DialogRoot open>
        <DialogPopup aria-label="Settings">
          <p>Body</p>
        </DialogPopup>
      </DialogRoot>
    );
    const dialog = container.querySelector('dialog')!;
    expect(dialog.getAttribute('aria-label')).toBe('Settings');
    expect(dialog.getAttribute('aria-labelledby')).toBeNull();
  });

  it('closes on a backdrop click (target is the dialog element)', () => {
    const { getByText, container } = render(<Basic />);
    fireEvent.click(getByText('Open'));
    const dialog = container.querySelector('dialog')!;
    fireEvent.click(dialog); // target === dialog => backdrop
    expect(dialog.getAttribute('data-state')).toBe('closed');
  });

  it('does not close on an inner content click', () => {
    const { getByText, container } = render(<Basic />);
    fireEvent.click(getByText('Open'));
    const dialog = container.querySelector('dialog')!;
    fireEvent.click(container.querySelector('h2')!);
    expect(dialog.getAttribute('data-state')).toBe('open');
  });

  it('closeOnBackdropClick={false} keeps the dialog open on backdrop click', () => {
    const { getByText, container } = render(
      <Basic closeOnBackdropClick={false} />
    );
    fireEvent.click(getByText('Open'));
    const dialog = container.querySelector('dialog')!;
    fireEvent.click(dialog);
    expect(dialog.getAttribute('data-state')).toBe('open');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/ui/src/__tests__/dialog-popup.test.tsx`
Expected: FAIL (`DialogPopup` is not exported).

- [ ] **Step 3: Append `DialogPopup` to `dialog.tsx`**

Add these imports to the existing `preact/hooks` import in `dialog.tsx` (merge into the destructured list): `useEffect`, `useLayoutEffect`. The import line becomes:

```tsx
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
```

Append to `dialog.tsx`:

```tsx
export type DialogPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  'aria-label'?: string; // alternative to a Title
  closeOnBackdropClick?: boolean; // default true
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDialogElement>, 'children'>;

export function DialogPopup(props: DialogPopupProps): VNode {
  const {
    render,
    children,
    closeOnBackdropClick = true,
    'aria-label': ariaLabel,
    onClick,
    ...rest
  } = props;
  const ctx = useDialogContext('Popup');

  // Drive the native element from open-state. showModal/close live in a
  // layout effect (client only), so the server never touches the DOM.
  useLayoutEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;
    if (ctx.open && !el.open) el.showModal();
    else if (!ctx.open && el.open) el.close();
  }, [ctx.open]);

  // Native dismissal (Escape, programmatic close()) fires `close`; mirror it
  // back into open-state so the two never desync.
  useEffect(() => {
    const el = ctx.dialogRef.current;
    if (!el) return;
    const onClose = () => ctx.setOpen(false);
    el.addEventListener('close', onClose);
    return () => el.removeEventListener('close', onClose);
  }, [ctx.setOpen]);

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDialogElement>) => {
    onClick?.(event);
    // A modal <dialog> reports backdrop clicks as targeting the element itself.
    if (closeOnBackdropClick && event.target === ctx.dialogRef.current) {
      ctx.setOpen(false);
    }
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'dialog',
    props: {
      ...rest,
      ref: ctx.dialogRef,
      id: ctx.popupId,
      'data-state': ctx.open ? 'open' : 'closed',
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabel ? undefined : ctx.titleId,
      'aria-describedby': ctx.hasDescription ? ctx.descriptionId : undefined,
      onClick: handleClick,
    },
    state: { open: ctx.open },
    children,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/ui/src/__tests__/dialog-popup.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/dialog/dialog.tsx packages/ui/src/__tests__/dialog-popup.test.tsx
git commit -m "feat(ui): add Dialog Popup on native dialog element

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Dialog Title and Description

**Files:**
- Modify: `packages/ui/src/dialog/dialog.tsx` (append `DialogTitle`, `DialogDescription`)
- Test: `packages/ui/src/__tests__/dialog-describe.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/__tests__/dialog-describe.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import {
  DialogRoot,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from '../dialog/dialog.js';

describe('Dialog Title and Description', () => {
  it('Title renders an h2 carrying the title id', () => {
    const { container } = render(
      <DialogRoot open>
        <DialogPopup>
          <DialogTitle>Hello</DialogTitle>
        </DialogPopup>
      </DialogRoot>
    );
    const title = container.querySelector('h2')!;
    const dialog = container.querySelector('dialog')!;
    expect(title.textContent).toBe('Hello');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('wires aria-describedby only when a Description is rendered', () => {
    const { container } = render(
      <DialogRoot open>
        <DialogPopup aria-label="x">
          <DialogDescription>Details</DialogDescription>
        </DialogPopup>
      </DialogRoot>
    );
    const desc = container.querySelector('p')!;
    const dialog = container.querySelector('dialog')!;
    expect(desc.id).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBe(desc.id);
  });

  it('omits aria-describedby when no Description is present', () => {
    const { container } = render(
      <DialogRoot open>
        <DialogPopup aria-label="x">
          <p>plain</p>
        </DialogPopup>
      </DialogRoot>
    );
    expect(
      container.querySelector('dialog')!.getAttribute('aria-describedby')
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/ui/src/__tests__/dialog-describe.test.tsx`
Expected: FAIL (`DialogTitle`/`DialogDescription` not exported).

- [ ] **Step 3: Append `DialogTitle` and `DialogDescription` to `dialog.tsx`**

```tsx
export type DialogTitleProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLHeadingElement>, 'children'>;

export function DialogTitle(props: DialogTitleProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useDialogContext('Title');
  return useRender({
    render,
    defaultTag: 'h2',
    props: { ...rest, id: ctx.titleId },
    children,
  });
}

export type DialogDescriptionProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLParagraphElement>, 'children'>;

export function DialogDescription(props: DialogDescriptionProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useDialogContext('Description');
  // Register presence so the Popup wires aria-describedby; deregister on
  // unmount (registerDescription returns its own cleanup).
  useLayoutEffect(() => ctx.registerDescription(), [ctx.registerDescription]);
  return useRender({
    render,
    defaultTag: 'p',
    props: { ...rest, id: ctx.descriptionId },
    children,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/ui/src/__tests__/dialog-describe.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/dialog/dialog.tsx packages/ui/src/__tests__/dialog-describe.test.tsx
git commit -m "feat(ui): add Dialog Title and Description with aria wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Dialog Close, the `Dialog` namespace, and the dialog barrel

**Files:**
- Modify: `packages/ui/src/dialog/dialog.tsx` (append `DialogClose` + `Dialog` namespace)
- Create: `packages/ui/src/dialog/index.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/__tests__/dialog-close.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/__tests__/dialog-close.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { Dialog } from '../dialog/index.js';

let close: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
    function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }
  );
  close = vi
    .spyOn(HTMLDialogElement.prototype, 'close')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });
});
afterEach(() => vi.restoreAllMocks());

describe('Dialog.Close and the namespace', () => {
  it('exposes every part on the Dialog namespace', () => {
    expect(typeof Dialog.Root).toBe('function');
    expect(typeof Dialog.Trigger).toBe('function');
    expect(typeof Dialog.Popup).toBe('function');
    expect(typeof Dialog.Title).toBe('function');
    expect(typeof Dialog.Description).toBe('function');
    expect(typeof Dialog.Close).toBe('function');
  });

  it('Close button closes the dialog', () => {
    const { getByText, container } = render(
      <Dialog.Root defaultOpen>
        <Dialog.Popup aria-label="x">
          <Dialog.Close>Done</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Root>
    );
    fireEvent.click(getByText('Done'));
    expect(close).toHaveBeenCalled();
    expect(container.querySelector('dialog')!.getAttribute('data-state')).toBe(
      'closed'
    );
  });

  it('render prop swaps the element and merges props on a part', () => {
    const { getByTestId } = render(
      <Dialog.Root>
        <Dialog.Trigger render={<a data-testid="link" href="#x" />}>
          Open
        </Dialog.Trigger>
      </Dialog.Root>
    );
    const link = getByTestId('link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('aria-haspopup')).toBe('dialog');
    expect(link.getAttribute('href')).toBe('#x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/ui/src/__tests__/dialog-close.test.tsx`
Expected: FAIL (`../dialog/index.js` missing; `DialogClose`/`Dialog` not exported).

- [ ] **Step 3: Append `DialogClose` and the `Dialog` namespace to `dialog.tsx`**

```tsx
export type DialogCloseProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function DialogClose(props: DialogCloseProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = useDialogContext('Close');

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    ctx.setOpen(false);
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      type: 'button',
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
    },
    state: { open: ctx.open },
    children,
  });
}

export const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
};
```

- [ ] **Step 4: Create `packages/ui/src/dialog/index.ts`**

```ts
export * from './dialog.js';
```

- [ ] **Step 5: Export Dialog from the package barrel**

In `packages/ui/src/index.ts`, add:

```ts
export {
  Dialog,
  DialogRoot,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
  type DialogRootProps,
  type DialogTriggerProps,
  type DialogPopupProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
  type DialogCloseProps,
} from './dialog/index.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test packages/ui/src/__tests__/dialog-close.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck the whole package barrel**

Run: `pnpm --filter @hono-preact/ui build && pnpm typecheck`
Expected: PASS (dist emits, types resolve).

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/dialog/dialog.tsx packages/ui/src/dialog/index.ts packages/ui/src/index.ts packages/ui/src/__tests__/dialog-close.test.tsx
git commit -m "feat(ui): add Dialog Close and the Dialog namespace barrel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Dialog SSR rendering

**Files:**
- Test: `packages/ui/src/__tests__/dialog-ssr.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/__tests__/dialog-ssr.test.tsx` (default `node` environment, no docblock):

```tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import {
  Dialog,
} from '../dialog/index.js';

describe('Dialog SSR', () => {
  it('renders a closed dialog (no open attribute) without touching the DOM', () => {
    const html = renderToString(
      <Dialog.Root>
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Popup>
          <Dialog.Title>Title</Dialog.Title>
          <Dialog.Description>Body</Dialog.Description>
        </Dialog.Popup>
      </Dialog.Root>
    );
    expect(html).toContain('<dialog');
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it('produces stable, matching ids for label wiring', () => {
    const html = renderToString(
      <Dialog.Root>
        <Dialog.Popup>
          <Dialog.Title>Title</Dialog.Title>
        </Dialog.Popup>
      </Dialog.Root>
    );
    const labelledby = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledby).toBeTruthy();
    // The Title's id must equal what the Popup points at.
    expect(html).toContain(`id="${labelledby}"`);
  });

  it('defaultOpen renders closed on the server (top layer is client-only)', () => {
    const html = renderToString(
      <Dialog.Root defaultOpen>
        <Dialog.Popup aria-label="x">
          <p>Body</p>
        </Dialog.Popup>
      </Dialog.Root>
    );
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    expect(html).toContain('data-state="open"');
  });
});
```

> Note the third case: `defaultOpen` sets `data-state="open"` (state is open) but the element renders without the `open` attribute on the server, because `showModal()` lives in a client-only layout effect. This documents the accepted SSR limitation from spec Section 6.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/ui/src/__tests__/dialog-ssr.test.tsx`
Expected: FAIL initially only if `preact-render-to-string` is unresolved. If Task 1 added it as a devDep and `pnpm install` ran, the test should run; it should PASS against the implementation from Tasks 6 to 9. If it FAILS on an assertion, fix the component, not the test.

> This task is a verification/guard test: the implementation already exists. If all three assertions pass on first run, that is the expected outcome (no production code change). If `preact-render-to-string` does not resolve, confirm Task 1 Step 1 added it under `packages/ui` devDependencies and rerun `pnpm install`.

- [ ] **Step 3: Run the full ui suite**

Run: `pnpm test packages/ui`
Expected: PASS (all Dialog + primitive tests green).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/__tests__/dialog-ssr.test.tsx
git commit -m "test(ui): assert Dialog SSR renders closed with stable ids

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Docs `<CopyButton>`

**Files:**
- Create: `apps/site/src/components/docs/CopyButton.tsx`
- Test: `apps/site/src/components/docs/__tests__/CopyButton.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/site/src/components/docs/__tests__/CopyButton.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { CopyButton } from '../CopyButton.js';

describe('CopyButton', () => {
  it('copies the text and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { getByRole } = render(<CopyButton text="hello world" />);
    const btn = getByRole('button');
    expect(btn.textContent).toBe('Copy');

    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith('hello world');
    await waitFor(() => expect(btn.textContent).toBe('Copied'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test apps/site/src/components/docs/__tests__/CopyButton.test.tsx`
Expected: FAIL (`Cannot find module '../CopyButton.js'`).

- [ ] **Step 3: Write the implementation**

`apps/site/src/components/docs/CopyButton.tsx`:

```tsx
import { useState } from 'preact/hooks';

interface CopyButtonProps {
  text: string;
  class?: string;
}

// Copies `text` to the clipboard and flips its label to "Copied" briefly.
// Clipboard access is client-only; the handler runs on click, so SSR is safe.
export function CopyButton({ text, class: className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      class={className}
      onClick={onClick}
      aria-label="Copy code to clipboard"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test apps/site/src/components/docs/__tests__/CopyButton.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/docs/CopyButton.tsx apps/site/src/components/docs/__tests__/CopyButton.test.tsx
git commit -m "feat(site): add docs CopyButton

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Docs `<Example>` and `<CodeTabs>`

**Files:**
- Create: `apps/site/src/components/docs/Example.tsx`
- Create: `apps/site/src/components/docs/CodeTabs.tsx`
- Test: `apps/site/src/components/docs/__tests__/CodeTabs.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/site/src/components/docs/__tests__/CodeTabs.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { Example } from '../Example.js';
import { CodeTabs } from '../CodeTabs.js';

describe('Example', () => {
  it('renders children inside a bordered frame', () => {
    const { getByText, container } = render(
      <Example>
        <span>demo</span>
      </Example>
    );
    expect(getByText('demo')).toBeTruthy();
    expect(container.querySelector('.docs-example')).toBeTruthy();
  });
});

describe('CodeTabs', () => {
  const tabs = [
    { label: 'CSS', code: '.a { color: red; }', language: 'css' },
    { label: 'Tailwind', code: '<div class="text-red-500" />', language: 'html' },
  ];

  it('shows the first tab by default and switches on click', () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
    const { getByRole, getByText, queryByText } = render(
      <CodeTabs tabs={tabs} />
    );
    expect(getByText('.a { color: red; }')).toBeTruthy();
    expect(queryByText('<div class="text-red-500" />')).toBeNull();

    fireEvent.click(getByRole('tab', { name: 'Tailwind' }));
    expect(getByText('<div class="text-red-500" />')).toBeTruthy();
  });

  it('renders a Copy button for the active tab', () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
    const { getAllByRole } = render(<CodeTabs tabs={tabs} />);
    const copy = getAllByRole('button').find((b) => b.textContent === 'Copy');
    expect(copy).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test apps/site/src/components/docs/__tests__/CodeTabs.test.tsx`
Expected: FAIL (`Cannot find module '../Example.js'`).

- [ ] **Step 3: Write `Example.tsx`**

`apps/site/src/components/docs/Example.tsx`:

```tsx
import type { ComponentChildren } from 'preact';

interface ExampleProps {
  children: ComponentChildren;
}

// A bordered frame that hosts a live component demo on a docs page.
export function Example({ children }: ExampleProps) {
  return <div class="docs-example">{children}</div>;
}
```

- [ ] **Step 4: Write `CodeTabs.tsx`**

`apps/site/src/components/docs/CodeTabs.tsx`:

```tsx
import { useState } from 'preact/hooks';
import { CopyButton } from './CopyButton.js';

export interface CodeTab {
  label: string;
  code: string;
  language?: string;
}

interface CodeTabsProps {
  tabs: CodeTab[];
}

// Labeled code tabs with a per-tab Copy button. Used on docs pages to offer
// copyable styling in more than one flavor (e.g. CSS and Tailwind).
export function CodeTabs({ tabs }: CodeTabsProps) {
  const [active, setActive] = useState(0);
  const current = tabs[active];

  return (
    <div class="docs-codetabs">
      <div class="docs-codetabs__tablist" role="tablist">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={i === active}
            class="docs-codetabs__tab"
            onClick={() => setActive(i)}
          >
            {tab.label}
          </button>
        ))}
        <CopyButton text={current.code} class="docs-codetabs__copy" />
      </div>
      <pre class={`docs-codetabs__pre language-${current.language ?? 'text'}`}>
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test apps/site/src/components/docs/__tests__/CodeTabs.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/docs/Example.tsx apps/site/src/components/docs/CodeTabs.tsx apps/site/src/components/docs/__tests__/CodeTabs.test.tsx
git commit -m "feat(site): add docs Example and CodeTabs scaffolding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Dialog docs page, demo, nav, workspace dep, and skill update

**Files:**
- Modify: `apps/site/package.json` (add `@hono-preact/ui` workspace dep)
- Create: `apps/site/src/components/docs/DialogDemo.tsx`
- Create: `apps/site/src/pages/docs/components/dialog.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts` (add `Overlays` section + Dialog entry)
- Modify: `.claude/skills/add-docs-page.md` (note the Overlays section exists)

- [ ] **Step 1: Add the workspace dependency and install**

In `apps/site/package.json`, add to `dependencies` (alphabetical with the other `@hono-preact/*` deps):

```json
    "@hono-preact/ui": "workspace:*",
```

Run: `pnpm install`
Expected: `@hono-preact/ui` linked into `apps/site/node_modules`.

- [ ] **Step 2: Create the demo component**

`apps/site/src/components/docs/DialogDemo.tsx`:

```tsx
import { Dialog } from '@hono-preact/ui';

// A minimal, unstyled-by-default Dialog used as the live demo on the docs
// page. The page's copyable CSS/Tailwind examples supply the visual styling.
export function DialogDemo() {
  return (
    <Dialog.Root>
      <Dialog.Trigger class="docs-dialog-trigger">Open dialog</Dialog.Trigger>
      <Dialog.Popup class="docs-dialog">
        <Dialog.Title>Subscribe</Dialog.Title>
        <Dialog.Description>
          Get notified when we ship something new.
        </Dialog.Description>
        <div class="docs-dialog__actions">
          <Dialog.Close class="docs-dialog-trigger">Close</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: Create the docs page**

`apps/site/src/pages/docs/components/dialog.mdx`:

````mdx
import { Example } from '../../../components/docs/Example.js';
import { CodeTabs } from '../../../components/docs/CodeTabs.js';
import { DialogDemo } from '../../../components/docs/DialogDemo.js';

# Dialog

An accessible modal dialog built on the native `<dialog>` element. The browser
supplies the focus trap, background `inert`, top layer, and Escape-to-close;
`@hono-preact/ui` adds the ARIA wiring, open-state, and `render`-prop
composition. It ships unstyled: style it through the `data-state` contract.

## Demo

<Example>
  <DialogDemo />
</Example>

## Usage

```tsx
import { Dialog } from '@hono-preact/ui';

export function Subscribe() {
  return (
    <Dialog.Root>
      <Dialog.Trigger>Open dialog</Dialog.Trigger>
      <Dialog.Popup>
        <Dialog.Title>Subscribe</Dialog.Title>
        <Dialog.Description>Get notified when we ship.</Dialog.Description>
        <Dialog.Close>Close</Dialog.Close>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
```

## Styling

Every part exposes `data-state="open" | "closed"`. The popup is a native
`<dialog>`, so its backdrop is the `::backdrop` pseudo-element and entry
animation uses `@starting-style` (it degrades to no animation where
unsupported). Copy a starting point:

<CodeTabs
  tabs={[
    {
      label: 'CSS',
      language: 'css',
      code: `dialog[data-state='open'] {
  border: none;
  border-radius: 12px;
  padding: 1.5rem;
  max-width: 28rem;
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

@starting-style {
  dialog[data-state='open'] {
    opacity: 0;
    transform: translateY(8px);
  }
}

dialog::backdrop {
  background: rgb(0 0 0 / 0.5);
}

@media (prefers-reduced-motion: reduce) {
  dialog[data-state='open'] {
    transition: none;
  }
}`,
    },
    {
      label: 'Tailwind',
      language: 'html',
      code: `<Dialog.Popup
  class="max-w-md rounded-xl border-none p-6
         transition duration-150
         data-[state=open]:opacity-100
         starting:data-[state=open]:opacity-0
         backdrop:bg-black/50"
>
  ...
</Dialog.Popup>`,
    },
  ]}
/>

## Accessibility

A dialog must have an accessible name: render a `Dialog.Title` (wired through
`aria-labelledby`) or pass `aria-label` to `Dialog.Popup`. A `Dialog.Description`
is wired through `aria-describedby` when present. `role="dialog"` and
`aria-modal="true"` come implicitly from `<dialog>.showModal()`.

### Manual verification checklist

happy-dom cannot emulate the platform behaviors below; verify them by hand in a
real browser:

- Focus moves into the dialog on open and is trapped while it is open.
- Background content is `inert` (not focusable, hidden from the accessibility tree).
- Escape closes the dialog and focus returns to the trigger.
- The `::backdrop` covers the page and stacks above other content (top layer).
- A screen reader announces the dialog's name (and description, if present).
````

- [ ] **Step 4: Add the nav entry**

In `apps/site/src/pages/docs/nav.ts`, add a `PanelsTopLeft` (or another `lucide-preact`) icon import, and add an `Overlays` section to the `components` area `sections` array, after `Getting started`:

First, extend the icon import list at the top (add `PanelsTopLeft`):

```ts
  PanelsTopLeft,
```

Then add the section inside the `components` area's `sections` array (after the `Getting started` section object):

```ts
      {
        heading: 'Overlays',
        icon: PanelsTopLeft,
        entries: [{ title: 'Dialog', route: '/docs/components/dialog' }],
      },
```

- [ ] **Step 5: Update the `add-docs-page` skill so the convention stays documented**

In `.claude/skills/add-docs-page.md`, the "Components area sections" paragraph currently says to add `Overlays` (Dialog, Popover, Tooltip) when the first page is created. Update it to reflect that `Overlays` now exists with Dialog:

Replace the sentence beginning "Components area sections (under `basePath`...)" with:

```markdown
**Components area sections** (under `basePath` `/docs/components`): `Getting started`, `Overlays` (Dialog; Popover and Tooltip as they ship), then add `Collections` (Menu, Select, Combobox) and `Foundations` (LayerHost, FocusScope, collection/nav machinery) as those pages are created. When adding the first page of a not-yet-present section, create the section with an appropriate `lucide-preact` icon.
```

- [ ] **Step 6: Run docs parity tests + typecheck + site build**

Run: `pnpm test apps/site/src/pages/docs/__tests__`
Expected: PASS (nav <-> route parity holds with the new Dialog entry).

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm --filter site build`
Expected: build succeeds; the `/docs/components/dialog` route and the Dialog client chunk are emitted.

- [ ] **Step 7: Commit**

```bash
git add apps/site/package.json apps/site/src/components/docs/DialogDemo.tsx apps/site/src/pages/docs/components/dialog.mdx apps/site/src/pages/docs/nav.ts .claude/skills/add-docs-page.md pnpm-lock.yaml
git commit -m "docs(site): add Dialog component page with live demo and copyable styles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Size tracker Section C config

**Files:**
- Modify: `scripts/client-size-config.mjs`
- Test: `scripts/__tests__/client-size-config.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/__tests__/client-size-config.test.mjs`:

```js
import {
  UI_CORE_MODULES,
  COMPONENT_MODULES,
  componentTableGzip,
} from '../client-size-config.mjs';

describe('Section C config', () => {
  it('declares non-empty shared ui-core modules', () => {
    expect(Array.isArray(UI_CORE_MODULES)).toBe(true);
    expect(UI_CORE_MODULES.length).toBeGreaterThan(0);
  });

  it('declares a dialog component entry', () => {
    expect(COMPONENT_MODULES.dialog).toBeDefined();
    expect(COMPONENT_MODULES.dialog.length).toBeGreaterThan(0);
  });

  it('componentTableGzip shows total for ui-core and marginal for components', () => {
    expect(
      componentTableGzip('ui-core', {
        total: { gzip: 500 },
        marginalOverUiCore: { gzip: 500 },
      })
    ).toBe(500);
    expect(
      componentTableGzip('dialog', {
        total: { gzip: 900 },
        marginalOverUiCore: { gzip: 400 },
      })
    ).toBe(400);
  });
});
```

> If `client-size-config.test.mjs` does not already `import { describe, it, expect } from 'vitest';` at the top, add that import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test scripts/__tests__/client-size-config.test.mjs`
Expected: FAIL (`UI_CORE_MODULES` is undefined).

- [ ] **Step 3: Add Section C config**

Append to `scripts/client-size-config.mjs` (after the `EXTERNAL` export, before the Section B block, keeping related config together):

```js
// Section C: per-component cost from packages/ui/dist. The shared primitives
// form the `ui-core` floor; each component lists the dist module(s) its public
// entry pulls in. Measured like Section A: total (isolated) plus marginal over
// ui-core (= (ui-core + component) bundle - ui-core bundle).
export const UI_CORE_MODULES = [
  'use-render.js',
  'merge-refs.js',
  'use-controllable-state.js',
];

export const COMPONENT_MODULES = {
  dialog: ['dialog/index.js'],
};
```

Append to the bottom of `scripts/client-size-config.mjs` (next to `tableGzip`):

```js
// The gzip number shown in the Section C table for a component: `ui-core`
// shows its own total; every component shows its marginal cost over ui-core.
export function componentTableGzip(name, entry) {
  return name === 'ui-core' ? entry.total.gzip : entry.marginalOverUiCore.gzip;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test scripts/__tests__/client-size-config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/client-size-config.mjs scripts/__tests__/client-size-config.test.mjs
git commit -m "feat(size): add Section C config for per-component sizes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Size tracker Section C measurement

**Files:**
- Modify: `scripts/measure-client-size.mjs`
- Test: `scripts/__tests__/measure-client-size.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/__tests__/measure-client-size.test.mjs`:

```js
import { measureSectionC } from '../measure-client-size.mjs';

describe('measureSectionC', () => {
  it('returns ui-core plus each component with a non-negative marginal', async () => {
    const c = await measureSectionC();
    // packages/ui/dist must be built (CI builds @hono-preact/* before tests).
    expect(c['ui-core']).toBeDefined();
    expect(c['ui-core'].total.gzip).toBeGreaterThan(0);
    expect(c.dialog.total.gzip).toBeGreaterThan(0);
    expect(c.dialog.marginalOverUiCore.gzip).toBeGreaterThanOrEqual(0);
  });
});

describe('historyRow includes Section C', () => {
  it('flattens sectionC to gzip-only per component', () => {
    const report = {
      sectionA: { core: { total: { gzip: 1 }, marginalOverCore: { gzip: 1 } } },
      sectionB: { buckets: { app: 2 }, total: 2 },
      sectionC: {
        'ui-core': { total: { gzip: 5 }, marginalOverUiCore: { gzip: 5 } },
        dialog: { total: { gzip: 9 }, marginalOverUiCore: { gzip: 4 } },
      },
    };
    const row = historyRow(report, 'abc1234', '2026-06-03');
    expect(row.sectionC).toEqual({ 'ui-core': 5, dialog: 4 });
  });
});
```

> Add `measureSectionC` to the existing import from `../measure-client-size.mjs` at the top of the file (it already imports `bundleSize, measureSectionA, measureSectionB, historyRow`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test scripts/__tests__/measure-client-size.test.mjs`
Expected: FAIL (`measureSectionC` is not exported; `historyRow` lacks `sectionC`).

- [ ] **Step 3: Generalize `entryFor` and add `measureSectionC`**

In `scripts/measure-client-size.mjs`:

(a) Add `existsSync` to the `node:fs` import:

```js
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from 'node:fs';
```

(b) Import the Section C config (extend the existing import from `./client-size-config.mjs`):

```js
import {
  CORE_MODULES,
  FEATURE_MODULES,
  EXTERNAL,
  UI_CORE_MODULES,
  COMPONENT_MODULES,
  bucketForChunk,
  tableGzip,
  componentTableGzip,
} from './client-size-config.mjs';
```

(c) Generalize `entryFor` with a `distBase` parameter (default keeps existing callers working):

```js
// Build an entry that namespace-re-exports each dist module so nothing is
// tree-shaken (sideEffects:false would otherwise drop side-effect-free
// imports). `distBase` selects the package's dist directory.
function entryFor(modules, distBase = 'packages/iso/dist') {
  return modules
    .map((m, i) => `export * as m${i} from './${distBase}/${m}';`)
    .join('\n');
}
```

(d) Add `measureSectionC` after `measureSectionB`:

```js
// Section C: per-component cost from packages/ui/dist. ui-core total, then each
// component's total (isolated) and marginal over ui-core. Returns {} when the
// ui package is not built so the measure never crashes on a partial tree.
export async function measureSectionC() {
  const base = 'packages/ui/dist';
  if (!existsSync(join(ROOT, base))) return {};
  const uiCore = await bundleSize(entryFor(UI_CORE_MODULES, base), ROOT);
  const sectionC = {
    'ui-core': { total: uiCore, marginalOverUiCore: uiCore },
  };
  for (const [name, modules] of Object.entries(COMPONENT_MODULES)) {
    const total = await bundleSize(entryFor(modules, base), ROOT);
    const combined = await bundleSize(
      entryFor([...UI_CORE_MODULES, ...modules], base),
      ROOT
    );
    sectionC[name] = {
      total,
      marginalOverUiCore: {
        raw: Math.max(0, combined.raw - uiCore.raw),
        gzip: Math.max(0, combined.gzip - uiCore.gzip),
        brotli: Math.max(0, combined.brotli - uiCore.brotli),
      },
    };
  }
  return sectionC;
}
```

(e) Bump `REPORT_VERSION` to `2` and add `sectionC` to `buildReport`:

```js
const REPORT_VERSION = 2;
```

```js
export async function buildReport(distDir) {
  return {
    version: REPORT_VERSION,
    sectionA: await measureSectionA(),
    sectionB: measureSectionB(distDir),
    sectionC: await measureSectionC(),
  };
}
```

(f) Add `sectionC` to `historyRow`:

```js
export function historyRow(report, sha, date) {
  const sectionA = {};
  for (const [bucket, entry] of Object.entries(report.sectionA)) {
    sectionA[bucket] = tableGzip(bucket, entry);
  }
  const sectionC = {};
  for (const [name, entry] of Object.entries(report.sectionC ?? {})) {
    sectionC[name] = componentTableGzip(name, entry);
  }
  return {
    sha,
    date,
    sectionA,
    sectionB: { buckets: report.sectionB.buckets, total: report.sectionB.total },
    sectionC,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test scripts/__tests__/measure-client-size.test.mjs`
Expected: PASS (existing Section A/B tests still green; new Section C tests green).

> If the `measureSectionC` smoke test fails because `packages/ui/dist` is absent, build it first: `pnpm --filter @hono-preact/ui build`, then rerun.

- [ ] **Step 5: Commit**

```bash
git add scripts/measure-client-size.mjs scripts/__tests__/measure-client-size.test.mjs
git commit -m "feat(size): measure Section C per-component sizes from packages/ui/dist

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Size tracker Section C rendering

**Files:**
- Modify: `scripts/render-size-comment.mjs`
- Test: `scripts/__tests__/render-size-comment.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/__tests__/render-size-comment.test.mjs`:

```js
describe('Section C rendering', () => {
  function reportWithC(c) {
    return {
      sectionA: {
        core: { total: { gzip: 15000 }, marginalOverCore: { gzip: 15000 } },
      },
      sectionB: { buckets: { app: 1000 }, total: 1000 },
      sectionC: c,
    };
  }

  const base = reportWithC({
    'ui-core': { total: { gzip: 500 }, marginalOverUiCore: { gzip: 500 } },
    dialog: { total: { gzip: 900 }, marginalOverUiCore: { gzip: 400 } },
  });

  it('renders a Components table with ui-core total and component marginal', () => {
    const md = renderComment(base, base, cfg);
    expect(md).toContain('Components');
    expect(md).toMatch(/ui-core.*500 B/s);
    expect(md).toMatch(/dialog.*400 B/s);
  });

  it('shows a delta when a component grows', () => {
    const fresh = reportWithC({
      'ui-core': { total: { gzip: 500 }, marginalOverUiCore: { gzip: 500 } },
      dialog: { total: { gzip: 1100 }, marginalOverUiCore: { gzip: 600 } },
    });
    const md = renderComment(fresh, base, cfg);
    expect(md).toContain('+200 B'); // dialog marginal 400 -> 600
  });

  it('marks components as (new) when the baseline lacks Section C', () => {
    const baselineNoC = {
      sectionA: base.sectionA,
      sectionB: base.sectionB,
    };
    const md = renderComment(base, baselineNoC, cfg);
    expect(md).toContain('Components');
    expect(md).toContain('(new)');
  });

  it('omits the Components table entirely when fresh has no Section C', () => {
    const noC = { sectionA: base.sectionA, sectionB: base.sectionB };
    const md = renderComment(noC, noC, cfg);
    expect(md).not.toContain('### Components');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test scripts/__tests__/render-size-comment.test.mjs`
Expected: FAIL (no Components table rendered).

- [ ] **Step 3: Add Section C rendering**

In `scripts/render-size-comment.mjs`:

(a) Extend the config import to include `componentTableGzip`:

```js
import { tableGzip, componentTableGzip } from './client-size-config.mjs';
```

(b) Add a `sectionCGzip` helper next to `sectionAGzip`:

```js
function sectionCGzip(report, name) {
  const e = report.sectionC?.[name];
  return e ? componentTableGzip(name, e) : undefined;
}
```

(c) In `renderComment`, after the Section B block (after `lines.push('<sub>Budgets are advisory; ...')`? No: insert the Section C block BEFORE the advisory `<sub>` footer line so both tables precede the footer). Concretely, insert immediately after the Section B `lines.push('')` that follows the total row, and before the `lines.push('<sub>Budgets are advisory; ...')` line:

```js
  // Section C (per-component; only when the fresh report carries one)
  if (fresh.sectionC && Object.keys(fresh.sectionC).length > 0) {
    lines.push(
      '### Components (gzip; `ui-core` is total, components marginal over it)'
    );
    lines.push('| Component | Size | Δ vs base |');
    lines.push('|---|---|---|');
    const cNames = new Set([
      ...Object.keys(fresh.sectionC),
      ...Object.keys(baseline.sectionC ?? {}),
    ]);
    for (const name of cNames) {
      lines.push(
        row(name, sectionCGzip(fresh, name), sectionCGzip(baseline, name), undefined)
      );
    }
    lines.push('');
  }
```

> Section C rows are unbudgeted in this slice (the `budget` arg is `undefined`); a budget can be added later once the measured baseline is known, mirroring how Section A's `core` budget was tuned after first measurement.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test scripts/__tests__/render-size-comment.test.mjs`
Expected: PASS (existing render tests still green; new Section C tests green).

- [ ] **Step 5: Commit**

```bash
git add scripts/render-size-comment.mjs scripts/__tests__/render-size-comment.test.mjs
git commit -m "feat(size): render the per-component Section C table in the PR comment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Regenerate the committed baseline and run the full pre-push CI mirror

**Files:**
- Modify: `client-size-report.json` (regenerated with Section C, version 2)

- [ ] **Step 1: Build everything so all dist + the site exist**

Run: `pnpm build`
Expected: all `@hono-preact/*` packages (including `@hono-preact/ui`), the umbrella, and `apps/site` build successfully.

- [ ] **Step 2: Regenerate the committed size baseline**

Run: `node scripts/measure-client-size.mjs`
Expected: `client-size-report.json` rewritten with `"version": 2` and a populated `sectionC` (`ui-core` plus `dialog`). The console prints the site total.

Inspect the diff:

Run: `git --no-pager diff client-size-report.json`
Expected: a new `sectionC` object and the version bump; Section A/B numbers may shift only if unrelated code changed (they should be stable).

- [ ] **Step 3: Run the six CI steps in order (project CLAUDE.md pre-push sequence)**

Run each and confirm PASS before moving on:

1. `pnpm --filter '@hono-preact/*' --filter hono-preact build`
2. `pnpm format:check`  (if it fails: `pnpm format`, then re-run)
3. `pnpm typecheck`
4. `pnpm test:coverage`
5. `pnpm test:integration`
6. `pnpm --filter site build`

Expected: all six PASS. If `format:check` fails, run `pnpm format` and include the formatting changes in the commit.

- [ ] **Step 4: Commit the regenerated baseline (and any format fixes)**

```bash
git add client-size-report.json
git commit -m "chore(size): seed Section C per-component baseline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> The `client-size-history.jsonl` file is intentionally NOT touched here; it is appended only by the `main`-push CI job, so PRs never churn it (size design spec, "Historical data").

---

## Self-review (run by the plan author before handing off)

**1. Spec coverage:**

| Spec requirement | Task |
|---|---|
| New `packages/ui` package, peer-dep preact, sideEffects false, version 0.0.0 | 1 |
| `useRender`/`mergeRefs` (function form receives state) | 2, 3 |
| `useControllableState` (controlled/uncontrolled) | 4 |
| SSR-stable id wiring (`useId`) | 6 (Root) |
| `data-state` contract | 6 to 9 (every part) |
| Compound Dialog parts on native `<dialog>` | 6 to 9 |
| `showModal`/`close` sync, native `close` event sync, backdrop click | 7 |
| `aria-labelledby` / `aria-label` / `aria-describedby` wiring | 7, 8 |
| Entry-only animation via `@starting-style` (docs CSS) | 13 |
| SSR-closed rendering + stable ids | 10 |
| Docs `Example`/`CopyButton`/`CodeTabs` scaffolding | 11, 12 |
| Dialog docs page + nav (corrected to Components area) + workspace dep | 13 |
| `add-docs-page` skill updated | 13 |
| TDD throughout; platform behaviors flagged manual | every task; 13 checklist |
| Per-component size table (folded-in Section C) | 14, 15, 16, 17 |

**2. Placeholder scan:** no "TBD"/"add error handling"/"similar to Task N"; every code step shows full code. Confirmed.

**3. Type consistency:** `DialogContextValue` field names (`open`, `setOpen`, `dialogRef`, `triggerId`, `popupId`, `titleId`, `descriptionId`, `hasDescription`, `registerDescription`) are identical in `context.ts` (Task 5) and every consumer (Tasks 6 to 9). `RenderProp<State>` signature matches between `use-render.ts` (Task 3) and all part prop types. `marginalOverUiCore` is spelled identically across config (Task 14), measure (Task 15), and render (Task 16). `componentTableGzip` signature matches across all three size files. Confirmed.

---

## Execution handoff

Build phase is **subagent-driven** (chosen by the user): dispatch a fresh subagent per task with two-stage review between tasks, per superpowers:subagent-driven-development. Tasks are mostly sequential; Tasks 14 to 16 (size config/measure/render) depend only on Task 1 and may run in parallel with the docs tasks (11 to 13) if desired, but Task 17 must run last (it builds everything and regenerates the baseline).
