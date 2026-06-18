# Headless Toast Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a headless, accessible, Sonner-shaped Toast notification primitive to `hono-preact-ui`, with an imperative `toast()` API, compound rendering parts, a pre-mounted polite/assertive `aria-live` announcer, and full parity (positions, expand/collapse stacking, swipe-to-dismiss, CSS-transition reflow).

**Architecture:** Layered. A small core (module singleton store -> `<Toaster>` top-layer popover region -> `Toast.*` parts -> announcer -> auto-dismiss timers) is fully functional on its own; the parity behaviors (stacking, swipe) are additive layers expressed through `data-*` attributes and CSS variables the library sets. Reflow is CSS-transition-driven (toasts only shift along one axis, never reorder), so there is no JS FLIP and no mid-animation re-measure.

**Tech Stack:** Preact 10 (no `preact/compat`), TypeScript (`tsc` build), vitest + `@testing-library/preact` (happy-dom / node envs), the Popover API (mandatory), `usePresence` (existing, reduced-motion-aware exit).

Reference spec: `docs/superpowers/specs/2026-06-18-toast-primitive-design.md`.

## Global Constraints

These apply to every task implicitly.

- **No em-dashes** in prose, code comments, or commit messages (use commas/colons/parentheses/semicolons). Em-dashes are fine in CLI flags and markdown table separators.
- **Package:** all source lands under `packages/ui/src/toast/`; package dir `packages/ui`, name `hono-preact-ui`, node engines `>=20`.
- **No `preact/compat`.** Subscribe to the store with a `useReducer` force-update + `useEffect`, not `useSyncExternalStore`.
- **No type casts** outside accepted boundaries (untrusted JSON, FormData, DOM/module structural reads). Reshape types instead (type predicate, typed binding, generic value type). `as const` is allowed.
- **Headless:** the package ships zero styling. Behavior is exposed only through `data-*` attributes and CSS custom properties. All visuals live in the docs demo CSS or the consumer's CSS.
- **Popover API is mandatory** for the rendered region (no `position: fixed` fallback). The single exception: guard the `showPopover()` *call* with a `typeof` check, because the happy-dom test environment may not implement the Popover API; the element still renders either way, so this is test-env safety, not a production fallback.
- **Store ordering:** newest toast first (index 0 is the frontmost/newest).
- **Working directory / testing:** run every command in this plan from the **worktree root** (vitest resolves its `root` to the cwd, so running from `packages/ui` makes the root config's include globs miss and reports "No test files found"). Vitest paths are root-relative, e.g. `pnpm exec vitest run packages/ui/src/__tests__/toast-store.test.ts`. Pure/SSR tests use `// @vitest-environment node`; DOM tests use `// @vitest-environment happy-dom`. Use fake timers (`vi.useFakeTimers()`), `cleanup()` in `afterEach`, and wrap raw `document`/element event dispatch in `act(() => ...)`.
- **Commit trailer:** every `git commit` in this plan must end its message with this exact trailer line:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Pre-push (after the final task):** run the 6-step CI mirror from the repo root in order: framework build, `pnpm format:check`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm test:integration`, `pnpm --filter site build`. `pnpm format` fixes format failures (it skips `.css`, so verify CSS by eye).

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/ui/src/toast/toast-store.ts` | Module singleton store + all data types | 1 |
| `packages/ui/src/toast/toast.ts` | Public callable `toast` object (variants/custom/dismiss) | 2 |
| `packages/ui/src/toast/toast.ts` (extend) | `toast.promise` | 3 |
| `packages/ui/src/toast/announcer.tsx` | Pre-mounted polite/assertive live regions + `announce()` | 4 |
| `packages/ui/src/toast/context.ts` | `ToasterContext` + `ToastItemContext` | 5 |
| `packages/ui/src/toast/toaster.tsx` | `<Toaster>` region (popover, subscription, a11y, pause) | 5, 7, 8 |
| `packages/ui/src/toast/toast-parts.tsx` | `ToastRoot` + `Title`/`Description`/`Action`/`Close` | 6, 7, 8, 9 |
| `packages/ui/src/toast/use-toast-timer.ts` | Per-toast auto-dismiss timer with pause/resume | 7 |
| `packages/ui/src/toast/use-toast-swipe.ts` | Swipe-to-dismiss pointer hook | 9 |
| `packages/ui/src/toast/index.ts` | Toast barrel (flat + `Toast` namespace) | 10 |
| `packages/ui/src/index.ts` (modify) | Re-export the toast surface | 10 |
| `packages/ui/src/__tests__/exports.test.ts` (modify) | Drift gate for the toast surface | 10 |
| `scripts/client-size-config.mjs` (modify) | Size-table + chunk-bucket entries | 11 |
| `apps/site/src/components/docs/ToastDemo.tsx` | Live demo (conformant app code) | 12 |
| `apps/site/src/styles/root.css` (modify) | `.docs-toast*` demo styles | 12 |
| `apps/site/src/pages/docs/components/toast.mdx` | Docs page | 13 |
| `apps/site/src/pages/docs/nav.ts` (modify) | Nav entry | 13 |

---

### Task 1: Toast store and types

**Files:**
- Create: `packages/ui/src/toast/toast-store.ts`
- Test: `packages/ui/src/__tests__/toast-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Types `ToastType`, `ToastPosition`, `ToastAction`, `ToastOptions`, `ToastRecord`, `ToastInput`, `DismissReason`.
  - `class ToastStore` with `toasts: ToastRecord[]`, `subscribe(fn): () => void`, `add(input: ToastInput): string | number`, `update(id, patch: Partial<ToastRecord>): void`, `dismiss(id?: string | number, reason?: DismissReason): void`, `remove(id: string | number): void`.
  - `const toastStore: ToastStore` (the singleton).
  - `DEFAULT_DURATION = 4000`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ToastStore, DEFAULT_DURATION } from '../toast/toast-store.js';

describe('ToastStore', () => {
  it('adds newest-first and assigns an id', () => {
    const store = new ToastStore();
    const a = store.add({ title: 'first' });
    const b = store.add({ title: 'second' });
    expect(store.toasts.map((t) => t.id)).toEqual([b, a]);
    expect(store.toasts[0].title).toBe('second');
    expect(store.toasts[1].duration).toBe(DEFAULT_DURATION);
    expect(store.toasts[0].dismissed).toBe(false);
  });

  it('updates a record in place when an existing id is reused', () => {
    const store = new ToastStore();
    const id = store.add({ title: 'loading', type: 'loading' });
    store.add({ id, title: 'done', type: 'success' });
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0]).toMatchObject({ title: 'done', type: 'success' });
  });

  it('marks dismissed (keeps the record for exit) and fires the right callback', () => {
    const store = new ToastStore();
    const onDismiss = vi.fn();
    const onAutoClose = vi.fn();
    const id = store.add({ title: 'x', onDismiss, onAutoClose });
    store.dismiss(id, 'user');
    expect(store.toasts[0].dismissed).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAutoClose).not.toHaveBeenCalled();

    const id2 = store.add({ title: 'y', onDismiss, onAutoClose });
    store.dismiss(id2, 'timeout');
    expect(onAutoClose).toHaveBeenCalledTimes(1);
  });

  it('dismiss() with no id marks every undismissed toast', () => {
    const store = new ToastStore();
    store.add({ title: 'a' });
    store.add({ title: 'b' });
    store.dismiss();
    expect(store.toasts.every((t) => t.dismissed)).toBe(true);
  });

  it('remove() deletes by id', () => {
    const store = new ToastStore();
    const id = store.add({ title: 'a' });
    store.remove(id);
    expect(store.toasts).toHaveLength(0);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const store = new ToastStore();
    const seen = vi.fn();
    const unsub = store.subscribe(seen);
    store.add({ title: 'a' });
    expect(seen).toHaveBeenCalledTimes(1);
    unsub();
    store.add({ title: 'b' });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-store.test.ts`
Expected: FAIL (cannot find module `../toast/toast-store.js`).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/toast/toast-store.ts
import type { ComponentChildren, VNode } from 'preact';

export type ToastType =
  | 'default'
  | 'success'
  | 'error'
  | 'info'
  | 'warning'
  | 'loading'
  | 'custom';

export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type DismissReason = 'user' | 'timeout';

export interface ToastAction {
  label: ComponentChildren;
  onClick: (event: MouseEvent) => void;
}

// Options accepted by the public `toast(...)` calls.
export interface ToastOptions {
  id?: string | number;
  description?: ComponentChildren;
  duration?: number; // ms; Infinity = sticky. Default DEFAULT_DURATION.
  important?: boolean; // route the announcement to the assertive region
  action?: ToastAction;
  onDismiss?: (toast: ToastRecord) => void;
  onAutoClose?: (toast: ToastRecord) => void;
}

// The stored record. `dismissed` keeps a toast in the list while its exit
// animation plays; `remove()` deletes it once the animation finishes.
export interface ToastRecord {
  id: string | number;
  type: ToastType;
  title?: ComponentChildren;
  description?: ComponentChildren;
  jsx?: (id: string | number) => VNode; // toast.custom render fn
  duration: number;
  important: boolean;
  dismissed: boolean;
  action?: ToastAction;
  onDismiss?: (toast: ToastRecord) => void;
  onAutoClose?: (toast: ToastRecord) => void;
  createdAt: number;
}

// What add() accepts: any record field plus an optional id.
export type ToastInput = Partial<Omit<ToastRecord, 'id'>> & {
  id?: string | number;
};

type Listener = (toasts: ToastRecord[]) => void;

export const DEFAULT_DURATION = 4000;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast-${counter}`;
}

export class ToastStore {
  toasts: ToastRecord[] = [];
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.toasts);
  }

  add(input: ToastInput): string | number {
    const id = input.id ?? nextId();
    if (this.toasts.some((t) => t.id === id)) {
      this.update(id, input);
      return id;
    }
    const record: ToastRecord = {
      id,
      type: input.type ?? 'default',
      title: input.title,
      description: input.description,
      jsx: input.jsx,
      duration: input.duration ?? DEFAULT_DURATION,
      important: input.important ?? false,
      dismissed: false,
      action: input.action,
      onDismiss: input.onDismiss,
      onAutoClose: input.onAutoClose,
      createdAt: Date.now(),
    };
    this.toasts = [record, ...this.toasts];
    this.emit();
    return id;
  }

  update(id: string | number, patch: Partial<ToastRecord>): void {
    let changed = false;
    this.toasts = this.toasts.map((t) => {
      if (t.id !== id) return t;
      changed = true;
      return { ...t, ...patch, id };
    });
    if (changed) this.emit();
  }

  dismiss(id?: string | number, reason: DismissReason = 'user'): void {
    for (const t of this.toasts) {
      if ((id === undefined || t.id === id) && !t.dismissed) {
        if (reason === 'timeout') t.onAutoClose?.(t);
        else t.onDismiss?.(t);
      }
    }
    this.toasts = this.toasts.map((t) =>
      id === undefined || t.id === id ? { ...t, dismissed: true } : t
    );
    this.emit();
  }

  remove(id: string | number): void {
    const next = this.toasts.filter((t) => t.id !== id);
    if (next.length !== this.toasts.length) {
      this.toasts = next;
      this.emit();
    }
  }
}

// The app-wide singleton. Toasts are client-only (fired post-hydration), so a
// module singleton is SSR-safe: the queue is empty at render time and no
// toast() call runs during SSR.
export const toastStore = new ToastStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/toast-store.ts packages/ui/src/__tests__/toast-store.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): toast store singleton with dismiss/remove lifecycle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Public `toast` function object

**Files:**
- Create: `packages/ui/src/toast/toast.ts`
- Test: `packages/ui/src/__tests__/toast-fn.test.ts`

**Interfaces:**
- Consumes: `toastStore`, `ToastOptions`, `ToastType` from `toast-store.ts`.
- Produces: `const toast` callable, with `toast(message, opts?)`, `.success`, `.error`, `.info`, `.warning`, `.loading`, `.custom(render, opts?)`, `.dismiss(id?)`. (`toast.promise` is added in Task 3.) `toast.error` defaults `important` to true. Each returns the toast id.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';

function reset() {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
}

describe('toast()', () => {
  it('adds a default toast and returns its id', () => {
    reset();
    const id = toast('Saved');
    const rec = toastStore.toasts.find((t) => t.id === id);
    expect(rec?.type).toBe('default');
    expect(rec?.title).toBe('Saved');
  });

  it('variant helpers set the type; error is important', () => {
    reset();
    toast.success('ok');
    toast.error('bad');
    const types = toastStore.toasts.map((t) => t.type);
    expect(types).toContain('success');
    expect(types).toContain('error');
    const err = toastStore.toasts.find((t) => t.type === 'error');
    expect(err?.important).toBe(true);
  });

  it('passes description and duration through options', () => {
    reset();
    const id = toast('Title', { description: 'more', duration: 1000 });
    const rec = toastStore.toasts.find((t) => t.id === id);
    expect(rec?.description).toBe('more');
    expect(rec?.duration).toBe(1000);
  });

  it('custom() stores a render function and type=custom', () => {
    reset();
    const id = toast.custom(() => null as never);
    const rec = toastStore.toasts.find((t) => t.id === id);
    expect(rec?.type).toBe('custom');
    expect(typeof rec?.jsx).toBe('function');
  });

  it('dismiss(id) marks that toast dismissed', () => {
    reset();
    const id = toast('x');
    toast.dismiss(id);
    expect(toastStore.toasts.find((t) => t.id === id)?.dismissed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-fn.test.ts`
Expected: FAIL (cannot find module `../toast/toast.js`).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/toast/toast.ts
import type { ComponentChildren, VNode } from 'preact';
import {
  toastStore,
  type ToastOptions,
  type ToastType,
} from './toast-store.js';

type Message = ComponentChildren;

function create(type: ToastType, message: Message, opts: ToastOptions = {}) {
  return toastStore.add({
    ...opts,
    type,
    title: message,
    important: opts.important ?? type === 'error',
  });
}

function toastFn(message: Message, opts?: ToastOptions) {
  return create('default', message, opts);
}

const toast = Object.assign(toastFn, {
  success: (message: Message, opts?: ToastOptions) =>
    create('success', message, opts),
  error: (message: Message, opts?: ToastOptions) =>
    create('error', message, opts),
  info: (message: Message, opts?: ToastOptions) =>
    create('info', message, opts),
  warning: (message: Message, opts?: ToastOptions) =>
    create('warning', message, opts),
  loading: (message: Message, opts?: ToastOptions) =>
    create('loading', message, opts),
  custom: (render: (id: string | number) => VNode, opts: ToastOptions = {}) =>
    toastStore.add({ ...opts, type: 'custom', jsx: render }),
  dismiss: (id?: string | number) => toastStore.dismiss(id, 'user'),
});

export { toast };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-fn.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/toast.ts packages/ui/src/__tests__/toast-fn.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): public toast() fn with variants, custom, and dismiss

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `toast.promise`

**Files:**
- Modify: `packages/ui/src/toast/toast.ts`
- Test: `packages/ui/src/__tests__/toast-promise.test.ts`

**Interfaces:**
- Consumes: `toast`, `toastStore`.
- Produces: `toast.promise(promise, msgs)` where `msgs = { loading, success, error }`. `success`/`error` may be values or functions of the resolved value / rejection. Adds one `loading` toast immediately and updates the same id to `success` or `error` on settle (sticky `loading`, default duration once settled). Returns the id.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toast } from '../toast/toast.js';
import { toastStore, DEFAULT_DURATION } from '../toast/toast-store.js';

function find(id: string | number) {
  return toastStore.toasts.find((t) => t.id === id);
}

describe('toast.promise', () => {
  it('starts loading (sticky) then resolves to success', async () => {
    let resolve!: (v: string) => void;
    const p = new Promise<string>((r) => (resolve = r));
    const id = toast.promise(p, {
      loading: 'Saving',
      success: (v) => `Saved ${v}`,
      error: 'Failed',
    });
    expect(find(id)).toMatchObject({ type: 'loading', title: 'Saving' });
    expect(find(id)?.duration).toBe(Infinity);

    resolve('row');
    await p;
    await Promise.resolve();
    expect(find(id)).toMatchObject({ type: 'success', title: 'Saved row' });
    expect(find(id)?.duration).toBe(DEFAULT_DURATION);
  });

  it('rejects to an important error toast', async () => {
    const p = Promise.reject(new Error('nope'));
    const id = toast.promise(p, {
      loading: 'Loading',
      success: 'ok',
      error: (e) => `Error: ${(e as Error).message}`,
    });
    await p.catch(() => undefined);
    await Promise.resolve();
    expect(find(id)).toMatchObject({ type: 'error', title: 'Error: nope' });
    expect(find(id)?.important).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-promise.test.ts`
Expected: FAIL (`toast.promise is not a function`).

- [ ] **Step 3: Write minimal implementation**

Add the import for `DEFAULT_DURATION` and the `promise` method. Replace the `import` line and the `Object.assign` block in `toast.ts`:

```ts
// at top of toast.ts, extend the existing import:
import {
  toastStore,
  DEFAULT_DURATION,
  type ToastOptions,
  type ToastType,
} from './toast-store.js';

// a message that may be static or computed from a value:
type LazyMessage<T> = ComponentChildren | ((value: T) => ComponentChildren);

interface PromiseMessages<T> {
  loading: ComponentChildren;
  success: LazyMessage<T>;
  error: LazyMessage<unknown>;
}

function resolveMessage<T>(m: LazyMessage<T>, value: T): ComponentChildren {
  return typeof m === 'function'
    ? (m as (value: T) => ComponentChildren)(value)
    : m;
}
```

Then add `promise` to the `Object.assign` literal (after `dismiss`):

```ts
  promise: <T>(promise: Promise<T>, msgs: PromiseMessages<T>) => {
    const id = toastStore.add({
      type: 'loading',
      title: msgs.loading,
      duration: Infinity,
    });
    promise.then(
      (value) =>
        toastStore.update(id, {
          type: 'success',
          title: resolveMessage(msgs.success, value),
          important: false,
          duration: DEFAULT_DURATION,
        }),
      (error: unknown) =>
        toastStore.update(id, {
          type: 'error',
          title: resolveMessage(msgs.error, error),
          important: true,
          duration: DEFAULT_DURATION,
        })
    );
    return id;
  },
```

Note: the `error` callback parameter is typed `unknown` (a rejection is not typed), and `resolveMessage`'s `LazyMessage<unknown>` accepts it without a cast.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-promise.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/toast.ts packages/ui/src/__tests__/toast-promise.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): toast.promise loading -> success/error in-place update

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Announcer (polite/assertive live regions)

**Files:**
- Create: `packages/ui/src/toast/announcer.tsx`
- Test: `packages/ui/src/__tests__/toast-announcer.test.tsx`

**Interfaces:**
- Consumes: `ToastRecord`.
- Produces:
  - `function useAnnouncer(): { politeRef, assertiveRef, announce }` where `announce(text: string, important: boolean): void` writes into the matching pre-mounted region and clears it after `ANNOUNCE_CLEAR_MS`.
  - `function ToastAnnouncer(props: { politeRef; assertiveRef }): VNode` rendering the two visually-hidden regions (`role=status`/`aria-live=polite` and `role=alert`/`aria-live=assertive`, both `aria-atomic`).
  - `function announcementText(record: ToastRecord): string` (title + description, stringified).
  - `const SR_ONLY_STYLE` (the inline visually-hidden style object).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { useAnnouncer, ToastAnnouncer } from '../toast/announcer.js';

afterEach(cleanup);

function Harness() {
  const a = useAnnouncer();
  return (
    <div>
      <button onClick={() => a.announce('Polite hello', false)}>polite</button>
      <button onClick={() => a.announce('Urgent hello', true)}>urgent</button>
      <ToastAnnouncer politeRef={a.politeRef} assertiveRef={a.assertiveRef} />
    </div>
  );
}

describe('ToastAnnouncer', () => {
  it('pre-mounts both live regions empty before any announcement', () => {
    const { getByRole } = render(<Harness />);
    const status = getByRole('status');
    const alert = getByRole('alert');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent).toBe('');
    expect(alert.textContent).toBe('');
  });

  it('routes polite vs assertive by importance', () => {
    vi.useFakeTimers();
    const { getByText, getByRole } = render(<Harness />);
    act(() => getByText('polite').click());
    expect(getByRole('status').textContent).toBe('Polite hello');
    expect(getByRole('alert').textContent).toBe('');
    act(() => getByText('urgent').click());
    expect(getByRole('alert').textContent).toBe('Urgent hello');
    vi.useRealTimers();
  });

  it('clears the region after the clear delay so a repeat re-announces', () => {
    vi.useFakeTimers();
    const { getByText, getByRole } = render(<Harness />);
    act(() => getByText('polite').click());
    expect(getByRole('status').textContent).toBe('Polite hello');
    act(() => vi.advanceTimersByTime(1000));
    expect(getByRole('status').textContent).toBe('');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-announcer.test.tsx`
Expected: FAIL (cannot find module `../toast/announcer.js`).

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/ui/src/toast/announcer.tsx
import { h, type JSX, type VNode } from 'preact';
import { useCallback, useRef } from 'preact/hooks';
import type { ToastRecord } from './toast-store.js';

// How long announcement text lingers before it is cleared, so re-announcing the
// same string later still triggers the live region.
const ANNOUNCE_CLEAR_MS = 1000;

// Visually-hidden but available to assistive tech (the standard sr-only recipe).
export const SR_ONLY_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

// Flatten a record's title + description to a plain announcement string. Only
// string/number children contribute; non-text VNodes are skipped.
export function announcementText(record: ToastRecord): string {
  const parts: string[] = [];
  for (const part of [record.title, record.description]) {
    if (typeof part === 'string' || typeof part === 'number') {
      parts.push(String(part));
    }
  }
  return parts.join(' ');
}

export interface UseAnnouncerResult {
  politeRef: { current: HTMLDivElement | null };
  assertiveRef: { current: HTMLDivElement | null };
  announce: (text: string, important: boolean) => void;
}

export function useAnnouncer(): UseAnnouncerResult {
  const politeRef = useRef<HTMLDivElement | null>(null);
  const assertiveRef = useRef<HTMLDivElement | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((text: string, important: boolean) => {
    if (!text) return;
    const node = important ? assertiveRef.current : politeRef.current;
    if (!node) return;
    node.textContent = text;
    if (clearTimer.current != null) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      if (politeRef.current) politeRef.current.textContent = '';
      if (assertiveRef.current) assertiveRef.current.textContent = '';
    }, ANNOUNCE_CLEAR_MS);
  }, []);

  return { politeRef, assertiveRef, announce };
}

export interface ToastAnnouncerProps {
  politeRef: { current: HTMLDivElement | null };
  assertiveRef: { current: HTMLDivElement | null };
}

export function ToastAnnouncer(props: ToastAnnouncerProps): VNode {
  return h('div', { style: SR_ONLY_STYLE }, [
    h('div', {
      key: 'polite',
      ref: props.politeRef,
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    }),
    h('div', {
      key: 'assertive',
      ref: props.assertiveRef,
      role: 'alert',
      'aria-live': 'assertive',
      'aria-atomic': 'true',
    }),
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-announcer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/announcer.tsx packages/ui/src/__tests__/toast-announcer.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): pre-mounted polite/assertive aria-live announcer for toasts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Context + `<Toaster>` region (core, no parity layer)

**Files:**
- Create: `packages/ui/src/toast/context.ts`
- Create: `packages/ui/src/toast/toaster.tsx`
- Test: `packages/ui/src/__tests__/toaster-region.test.tsx`
- Test: `packages/ui/src/__tests__/toaster-ssr.test.tsx`

**Interfaces:**
- Consumes: `toastStore`, `ToastRecord`, `ToastPosition`, `useAnnouncer`, `ToastAnnouncer`, `announcementText`.
- Produces:
  - `context.ts`: `ToasterContextValue` (`{ position, expanded, paused, gap, visibleToasts, registerHeight, heights, orderedIds }`), `ToasterContext`, `useToasterContext(part)`, `ToastItemContextValue` (`{ record }`), `ToastItemContext`, `useToastItemContext(part)`.
  - `toaster.tsx`: `Toaster(props: ToasterProps): VNode`, `type ToasterProps`. The `<Toaster>` subscribes to the store, mounts the announcer, announces each newly-added toast once, renders a top-layer `popover="manual"` region (`role=region`, configurable `aria-label`, an inner `<ol>`) and calls `children(record)` per non-removed toast.
  - In this task `registerHeight`/`heights`/`orderedIds`/`expanded`/`paused` exist in context but are static defaults (`expanded=false`, `paused=false`, `registerHeight` is a no-op returning a no-op cleanup); Tasks 7-9 make them live.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment happy-dom
// packages/ui/src/__tests__/toaster-region.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';

afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  cleanup();
});

function Region() {
  return (
    <Toaster position="top-center" label="Alerts">
      {(t) => <div data-testid={`toast-${t.id}`}>{t.title}</div>}
    </Toaster>
  );
}

describe('<Toaster> region', () => {
  it('renders an empty labeled region with both live regions pre-mounted', () => {
    const { getByRole } = render(<Region />);
    const region = getByRole('region', { name: 'Alerts' });
    expect(region).not.toBeNull();
    expect(region.getAttribute('data-position')).toBe('top-center');
    expect(getByRole('status')).not.toBeNull();
    expect(getByRole('alert')).not.toBeNull();
  });

  it('renders a toast via the render prop and announces it politely', () => {
    const { getByTestId, getByRole } = render(<Region />);
    let id: string | number = '';
    act(() => {
      id = toast('Hello');
    });
    expect(getByTestId(`toast-${id}`).textContent).toBe('Hello');
    expect(getByRole('status').textContent).toBe('Hello');
  });

  it('announces an error toast assertively', () => {
    const { getByRole } = render(<Region />);
    act(() => {
      toast.error('Boom');
    });
    expect(getByRole('alert').textContent).toBe('Boom');
  });
});
```

```tsx
// @vitest-environment node
// packages/ui/src/__tests__/toaster-ssr.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Toaster } from '../toast/toaster.js';
import { toastStore } from '../toast/toast-store.js';

describe('<Toaster> SSR', () => {
  it('renders a stable empty region with no toast() calls and no crash', () => {
    expect(toastStore.toasts).toHaveLength(0);
    const html = renderToString(
      <Toaster label="Notifications">{(t) => <div>{t.title}</div>}</Toaster>
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Notifications"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toaster-region.test.tsx packages/ui/src/__tests__/toaster-ssr.test.tsx`
Expected: FAIL (cannot find module `../toast/toaster.js`).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/toast/context.ts
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ToastPosition, ToastRecord } from './toast-store.js';

export interface ToasterContextValue {
  position: ToastPosition;
  gap: number;
  visibleToasts: number;
  expanded: boolean;
  paused: boolean;
  // Ordered ids of currently-rendered toasts (newest first). Used by an item to
  // find how many toasts sit in front of it.
  orderedIds: (string | number)[];
  // Measured heights keyed by id (px). Empty until Task 9 wires measurement.
  heights: Map<string | number, number>;
  // Register a toast's measured height; returns an unregister cleanup.
  registerHeight: (id: string | number, height: number) => void;
}

export const ToasterContext = createContext<ToasterContextValue | null>(null);

export function useToasterContext(part: string): ToasterContextValue {
  const ctx = useContext(ToasterContext);
  if (!ctx) {
    throw new Error(`<Toast.${part}> must be used within <Toaster>`);
  }
  return ctx;
}

export interface ToastItemContextValue {
  record: ToastRecord;
}

export const ToastItemContext = createContext<ToastItemContextValue | null>(
  null
);

export function useToastItemContext(part: string): ToastItemContextValue {
  const ctx = useContext(ToastItemContext);
  if (!ctx) {
    throw new Error(`<Toast.${part}> must be used within <Toast.Root>`);
  }
  return ctx;
}
```

```tsx
// packages/ui/src/toast/toaster.tsx
import { h, type ComponentChildren, type VNode } from 'preact';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'preact/hooks';
import {
  toastStore,
  type ToastPosition,
  type ToastRecord,
} from './toast-store.js';
import { ToasterContext } from './context.js';
import {
  ToastAnnouncer,
  useAnnouncer,
  announcementText,
} from './announcer.js';

export interface ToasterProps {
  position?: ToastPosition;
  label?: string;
  gap?: number;
  visibleToasts?: number;
  expand?: boolean;
  hotkey?: string[]; // wired in Task 7
  children: (toast: ToastRecord) => ComponentChildren;
}

// Subscribe to the store with a force-update; no preact/compat.
function useStoreToasts(): ToastRecord[] {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => toastStore.subscribe(force), []);
  return toastStore.toasts;
}

export function Toaster(props: ToasterProps): VNode {
  const {
    position = 'bottom-right',
    label = 'Notifications',
    gap = 14,
    visibleToasts = 3,
    expand = false,
    children,
  } = props;

  const toasts = useStoreToasts();
  const regionRef = useRef<HTMLElement | null>(null);
  const { politeRef, assertiveRef, announce } = useAnnouncer();

  // Promote the region to the top layer. Guarded for the happy-dom test env,
  // which may not implement the Popover API; production browsers always do.
  useEffect(() => {
    const el = regionRef.current;
    if (el && typeof el.showPopover === 'function' && !el.matches(':popover-open')) {
      el.showPopover();
    }
  }, []);

  // Announce each newly-added toast exactly once.
  const announced = useRef(new Set<string | number>());
  useEffect(() => {
    for (const t of toasts) {
      if (t.dismissed || announced.current.has(t.id)) continue;
      announced.current.add(t.id);
      announce(announcementText(t), t.important);
    }
    // Forget ids that have left so a reused id can re-announce.
    const live = new Set(toasts.map((t) => t.id));
    for (const id of announced.current) {
      if (!live.has(id)) announced.current.delete(id);
    }
  }, [toasts, announce]);

  const orderedIds = useMemo(() => toasts.map((t) => t.id), [toasts]);
  const heights = useRef(new Map<string | number, number>()).current;
  const registerHeight = useCallback(
    (_id: string | number, _height: number) => {
      // No-op until Task 9.
    },
    []
  );

  const ctx = useMemo(
    () => ({
      position,
      gap,
      visibleToasts,
      expanded: expand,
      paused: false,
      orderedIds,
      heights,
      registerHeight,
    }),
    [position, gap, visibleToasts, expand, orderedIds, heights, registerHeight]
  );

  return h(
    ToasterContext.Provider,
    { value: ctx },
    h(
      'section' as string,
      {
        ref: regionRef,
        popover: 'manual',
        role: 'region',
        'aria-label': label,
        'data-position': position,
        tabIndex: -1,
      },
      [
        h(ToastAnnouncer, { key: 'announcer', politeRef, assertiveRef }),
        h(
          'ol',
          { key: 'list' },
          toasts.map((t) => h('li', { key: t.id }, children(t)))
        ),
      ]
    )
  );
}
```

Note: `popover="manual"` and `tabIndex` are passed via `h`; the `'section' as string` is `as const`-style widening of the tag for `h` and is not a type cast on a value (acceptable). If the linter objects, lift the tag to `const TAG = 'section'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toaster-region.test.tsx packages/ui/src/__tests__/toaster-ssr.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/context.ts packages/ui/src/toast/toaster.tsx packages/ui/src/__tests__/toaster-region.test.tsx packages/ui/src/__tests__/toaster-ssr.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Toaster top-layer region with announcer wiring (core)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Toast parts (`Root`, `Title`, `Description`, `Action`, `Close`)

**Files:**
- Create: `packages/ui/src/toast/toast-parts.tsx`
- Test: `packages/ui/src/__tests__/toast-parts.test.tsx`

**Interfaces:**
- Consumes: `renderElement`/`RenderProp` (`../render-element.js`), `mergeRefs` (`../merge-refs.js`), `usePresence` (`../use-presence.js`), `toastStore`, `ToastRecord`, `ToastItemContext`, `useToastItemContext`.
- Produces: `ToastRoot(props: ToastRootProps)`, `ToastTitle`, `ToastDescription`, `ToastAction`, `ToastClose` and their prop types. `ToastRoot` provides `ToastItemContext`, drives `data-state` (`open`/`closed`) via `usePresence(!record.dismissed)`, and calls `toastStore.remove(id)` on exit complete. `data-type` reflects `record.type`. `ToastClose` calls `toast.dismiss(id)`; `ToastAction` runs `record.action.onClick` then dismisses. When `record.jsx` is set, `ToastRoot` renders it instead of `children`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import {
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
} from '../toast/toast-parts.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';
import { installReducedMotion } from './presence-helpers.js';

// Reduced motion makes usePresence finalize the exit synchronously, so removal
// is deterministic without faking animations.
let restore: (() => void) | undefined;
afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  restore?.();
  restore = undefined;
  cleanup();
});

function App() {
  return (
    <Toaster>
      {(t) => (
        <ToastRoot toast={t} data-testid={`root-${t.id}`}>
          <ToastTitle />
          <ToastDescription />
          <ToastAction />
          <ToastClose>x</ToastClose>
        </ToastRoot>
      )}
    </Toaster>
  );
}

describe('Toast parts', () => {
  it('renders title/description and reflects type via data-type', () => {
    const { getByTestId } = render(<App />);
    let id: string | number = '';
    act(() => {
      id = toast.success('Saved', { description: 'All good' });
    });
    const root = getByTestId(`root-${id}`);
    expect(root.getAttribute('data-type')).toBe('success');
    expect(root.getAttribute('data-state')).toBe('open');
    expect(root.textContent).toContain('Saved');
    expect(root.textContent).toContain('All good');
  });

  it('Close dismisses; with reduced motion the toast is then removed', () => {
    restore = installReducedMotion(true);
    const { getByText } = render(<App />);
    act(() => {
      toast('Bye');
    });
    act(() => fireEvent.click(getByText('x')));
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('Action runs its onClick and dismisses', () => {
    restore = installReducedMotion(true);
    let clicked = 0;
    const { getByText } = render(<App />);
    act(() => {
      toast('With action', {
        action: { label: 'Undo', onClick: () => (clicked += 1) },
      });
    });
    act(() => fireEvent.click(getByText('Undo')));
    expect(clicked).toBe(1);
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('renders a custom toast body via record.jsx', () => {
    const { getByTestId } = render(<App />);
    act(() => {
      toast.custom((id) => <span data-testid="custom">custom {id}</span>);
    });
    expect(getByTestId('custom').textContent).toContain('custom');
  });
});
```

Note: confirm `presence-helpers.js` exports `installReducedMotion`; the `usePresence` test (Task 0 reference) imports it, so it exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-parts.test.tsx`
Expected: FAIL (cannot find module `../toast/toast-parts.js`).

- [ ] **Step 3: Write minimal implementation**

```tsx
// packages/ui/src/toast/toast-parts.tsx
import {
  h,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import { useMemo } from 'preact/hooks';
import { renderElement, type RenderProp } from '../render-element.js';
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
import { toastStore, type ToastRecord } from './toast-store.js';
import { ToastItemContext, useToastItemContext } from './context.js';

export type ToastRootProps = {
  toast: ToastRecord;
  render?: RenderProp<{ type: string; open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLLIElement>, 'children'>;

export function ToastRoot(props: ToastRootProps): VNode {
  const { toast: record, render, children, ...rest } = props;

  const present = !record.dismissed;
  const { status, ref } = usePresence(present, {
    onExitComplete: () => toastStore.remove(record.id),
  });
  const open = status === 'open';

  const itemCtx = useMemo(() => ({ record }), [record]);

  const body = record.jsx ? record.jsx(record.id) : children;

  return h(
    ToastItemContext.Provider,
    { value: itemCtx },
    renderElement<{ type: string; open: boolean }>({
      render,
      defaultTag: 'div',
      props: {
        ...rest,
        ref: mergeRefs(ref, rest.ref as Parameters<typeof mergeRefs>[0]),
        role: 'listitem',
        'data-type': record.type,
        'data-state': open ? 'open' : 'closed',
      },
      state: { type: record.type, open },
      children: body,
    })
  );
}

export type ToastTitleProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ToastTitle(props: ToastTitleProps): VNode {
  const { render, children, ...rest } = props;
  const { record } = useToastItemContext('Title');
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, 'data-toast-title': '' },
    children: children ?? record.title,
  });
}

export type ToastDescriptionProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ToastDescription(props: ToastDescriptionProps): VNode | null {
  const { render, children, ...rest } = props;
  const { record } = useToastItemContext('Description');
  const content = children ?? record.description;
  if (content == null) return null;
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, 'data-toast-description': '' },
    children: content,
  });
}

export type ToastActionProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function ToastAction(props: ToastActionProps): VNode | null {
  const { render, children, onClick, ...rest } = props;
  const { record } = useToastItemContext('Action');
  if (!record.action) return null;
  const action = record.action;
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    action.onClick(event as unknown as MouseEvent);
    toastStore.dismiss(record.id, 'user');
  };
  return renderElement({
    render,
    defaultTag: 'button',
    props: { ...rest, type: 'button', onClick: handleClick },
    children: children ?? action.label,
  });
}

export type ToastCloseProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function ToastClose(props: ToastCloseProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const { record } = useToastItemContext('Close');
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    toastStore.dismiss(record.id, 'user');
  };
  return renderElement({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      type: 'button',
      'aria-label': (rest['aria-label'] as string | undefined) ?? 'Close',
      onClick: handleClick,
    },
    children: children ?? null,
  });
}
```

Note on the one `as unknown as MouseEvent` in `ToastAction`: the action callback is typed `(MouseEvent) => void` (DOM-level), and Preact's `TargetedMouseEvent` is structurally a `MouseEvent` at runtime. This is a structural DOM-event boundary; if the reviewer prefers, retype `ToastAction.onClick` as `(event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void` in `toast-store.ts` to remove the seam. Prefer the retype if it does not ripple.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-parts.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/toast-parts.tsx packages/ui/src/__tests__/toast-parts.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Toast.Root + Title/Description/Action/Close parts with exit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Auto-dismiss timer + region pause

**Files:**
- Create: `packages/ui/src/toast/use-toast-timer.ts`
- Modify: `packages/ui/src/toast/toaster.tsx` (track pause: hover/focus/visibility; provide `paused`)
- Modify: `packages/ui/src/toast/toast-parts.tsx` (`ToastRoot` runs the timer)
- Test: `packages/ui/src/__tests__/toast-timer.test.tsx`

**Interfaces:**
- Consumes: `useToasterContext`, `toastStore`.
- Produces: `useToastTimer(opts: { id; duration; paused; onExpire }): void`. The Toaster computes `paused = hovered || focused || documentHidden` and exposes it on context. `ToastRoot` calls `useToastTimer` with `paused` from context, dismissing with reason `'timeout'` on expiry.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import { ToastRoot, ToastTitle } from '../toast/toast-parts.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';
import { installReducedMotion } from './presence-helpers.js';

let restore: (() => void) | undefined;
afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  restore?.();
  restore = undefined;
  vi.useRealTimers();
  cleanup();
});

function App() {
  return (
    <Toaster>
      {(t) => (
        <ToastRoot toast={t} data-testid={`root-${t.id}`}>
          <ToastTitle />
        </ToastRoot>
      )}
    </Toaster>
  );
}

describe('toast auto-dismiss timer', () => {
  it('dismisses then removes after the duration elapses', () => {
    vi.useFakeTimers();
    restore = installReducedMotion(true);
    render(<App />);
    act(() => {
      toast('Auto', { duration: 1000 });
    });
    expect(toastStore.toasts).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('pauses while the region is hovered and resumes with remaining time', () => {
    vi.useFakeTimers();
    restore = installReducedMotion(true);
    const { getByRole } = render(<App />);
    act(() => {
      toast('Auto', { duration: 1000 });
    });
    const region = getByRole('region');
    act(() => vi.advanceTimersByTime(600));
    act(() => fireEvent.pointerEnter(region));
    act(() => vi.advanceTimersByTime(5000)); // paused: no expiry
    expect(toastStore.toasts).toHaveLength(1);
    act(() => fireEvent.pointerLeave(region));
    act(() => vi.advanceTimersByTime(400)); // 1000 - 600 remaining
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('never expires when duration is Infinity', () => {
    vi.useFakeTimers();
    restore = installReducedMotion(true);
    render(<App />);
    act(() => {
      toast.loading('Working', { duration: Infinity });
    });
    act(() => vi.advanceTimersByTime(100000));
    expect(toastStore.toasts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-timer.test.tsx`
Expected: FAIL (cannot find module `../toast/use-toast-timer.js`).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/toast/use-toast-timer.ts
import { useEffect, useRef } from 'preact/hooks';

export interface UseToastTimerOptions {
  id: string | number;
  duration: number; // ms; Infinity = never auto-dismiss
  paused: boolean;
  onExpire: () => void;
}

// Per-toast auto-dismiss timer. Banks elapsed time on pause and resumes with the
// remaining duration so hover/focus/tab-hidden never restart the countdown.
export function useToastTimer(opts: UseToastTimerOptions): void {
  const { id, duration, paused, onExpire } = opts;
  const remaining = useRef(duration);
  const startedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  // Reset the budget if the toast's duration changes (e.g. promise resolves).
  useEffect(() => {
    remaining.current = duration;
  }, [duration, id]);

  useEffect(() => {
    if (duration === Infinity) return;

    const clear = () => {
      if (timer.current != null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    if (paused) {
      if (startedAt.current != null) {
        remaining.current -= Date.now() - startedAt.current;
        startedAt.current = null;
      }
      clear();
      return;
    }

    startedAt.current = Date.now();
    timer.current = setTimeout(
      () => onExpireRef.current(),
      Math.max(0, remaining.current)
    );
    return clear;
  }, [paused, duration, id]);
}
```

In `toaster.tsx`, track pause and expose it. Add inside `Toaster`, before `ctx`:

```tsx
  // Pause auto-dismiss while the user is engaged with the region or the tab is
  // hidden. focusin/out are tracked on the region; visibility on the document.
  const [hovered, setHovered] = useReducer(
    (_: boolean, v: boolean) => v,
    false
  );
  const [focused, setFocused] = useReducer(
    (_: boolean, v: boolean) => v,
    false
  );
  const [docHidden, setDocHidden] = useReducer(
    (_: boolean, v: boolean) => v,
    false
  );
  useEffect(() => {
    const onVis = () => setDocHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const paused = hovered || focused || docHidden;
```

Add `useReducer` is already imported. Add the import for nothing else. Then change the region element's props to include the handlers, and pass `paused` into `ctx` (replace `paused: false`):

```tsx
      {
        ref: regionRef,
        popover: 'manual',
        role: 'region',
        'aria-label': label,
        'data-position': position,
        tabIndex: -1,
        onPointerEnter: () => setHovered(true),
        onPointerLeave: () => setHovered(false),
        onFocusin: () => setFocused(true),
        onFocusout: () => setFocused(false),
      },
```

And in the `ctx` `useMemo`, replace `paused: false,` with `paused,` and add `paused` to the dependency array.

In `toast-parts.tsx`, make `ToastRoot` run the timer. Add imports and the hook call. Change the top of `toast-parts.tsx`:

```tsx
import { useToasterContext } from './context.js';
import { useToastTimer } from './use-toast-timer.js';
```

Inside `ToastRoot`, after computing `open`, add:

```tsx
  const toaster = useToasterContext('Root');
  useToastTimer({
    id: record.id,
    duration: record.duration,
    paused: toaster.paused || record.dismissed,
    onExpire: () => toastStore.dismiss(record.id, 'timeout'),
  });
```

(Pausing while already dismissed prevents a redundant timeout-dismiss during the exit animation.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-timer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/use-toast-timer.ts packages/ui/src/toast/toaster.tsx packages/ui/src/toast/toast-parts.tsx packages/ui/src/__tests__/toast-timer.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): auto-dismiss timer with hover/focus/visibility pause

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Hotkey to focus the region

**Files:**
- Modify: `packages/ui/src/toast/toaster.tsx`
- Test: `packages/ui/src/__tests__/toast-hotkey.test.tsx`

**Interfaces:**
- Consumes: `ToasterProps.hotkey`.
- Produces: a document-level `keydown` listener that focuses the region when the configured chord (default `['altKey', 'KeyT']`) is pressed. The chord is an array of `KeyboardEvent` modifier booleans (`altKey`/`ctrlKey`/`metaKey`/`shiftKey`) and one `code`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import { ToastRoot, ToastTitle } from '../toast/toast-parts.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';

afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  cleanup();
});

describe('toast region hotkey', () => {
  it('focuses the region on Alt+T', () => {
    const { getByRole } = render(
      <Toaster>
        {(t) => (
          <ToastRoot toast={t}>
            <ToastTitle />
          </ToastRoot>
        )}
      </Toaster>
    );
    act(() => {
      toast('Hi');
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyT', altKey: true })
      );
    });
    expect(document.activeElement).toBe(getByRole('region'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-hotkey.test.tsx`
Expected: FAIL (active element is `<body>`, not the region).

- [ ] **Step 3: Write minimal implementation**

In `toaster.tsx`, read `hotkey` from props with a default, and add an effect. Update the destructure to include `hotkey = ['altKey', 'KeyT']`, then add:

```tsx
  useEffect(() => {
    const mods = new Set(
      hotkey.filter((k) => k.endsWith('Key'))
    ) as Set<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;
    const code = hotkey.find((k) => !k.endsWith('Key'));
    const onKeyDown = (event: KeyboardEvent) => {
      if (code && event.code !== code) return;
      if (mods.has('altKey') !== event.altKey) return;
      if (mods.has('ctrlKey') !== event.ctrlKey) return;
      if (mods.has('metaKey') !== event.metaKey) return;
      if (mods.has('shiftKey') !== event.shiftKey) return;
      regionRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hotkey]);
```

Note: the `Set<...>` is an `as` on a freshly-built `Set` of a known literal union; if the reviewer prefers no cast, build it as `const mods = { altKey: hotkey.includes('altKey'), ctrlKey: hotkey.includes('ctrlKey'), metaKey: hotkey.includes('metaKey'), shiftKey: hotkey.includes('shiftKey') }` and compare `mods.altKey !== event.altKey` etc. Prefer the object form (no cast).

Use the object form in the final code:

```tsx
  useEffect(() => {
    const want = {
      altKey: hotkey.includes('altKey'),
      ctrlKey: hotkey.includes('ctrlKey'),
      metaKey: hotkey.includes('metaKey'),
      shiftKey: hotkey.includes('shiftKey'),
    };
    const code = hotkey.find((k) => !k.endsWith('Key'));
    const onKeyDown = (event: KeyboardEvent) => {
      if (code && event.code !== code) return;
      if (
        want.altKey !== event.altKey ||
        want.ctrlKey !== event.ctrlKey ||
        want.metaKey !== event.metaKey ||
        want.shiftKey !== event.shiftKey
      ) {
        return;
      }
      regionRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hotkey]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-hotkey.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/toaster.tsx packages/ui/src/__tests__/toast-hotkey.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): configurable hotkey to focus the toast region (default Alt+T)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Stacking (height registry + expand/collapse + index vars)

**Files:**
- Modify: `packages/ui/src/toast/toaster.tsx` (live `registerHeight`/`heights`, `expanded = expand || hovered || focused`)
- Modify: `packages/ui/src/toast/toast-parts.tsx` (`ToastRoot` measures height, emits `data-front`/`data-expanded` and the stacking CSS vars)
- Test: `packages/ui/src/__tests__/toast-stacking.test.tsx`

**Interfaces:**
- Consumes: `useToasterContext` (now with live `heights`, `registerHeight`, `orderedIds`, `expanded`, `visibleToasts`, `gap`).
- Produces: `ToastRoot` sets, among undismissed toasts, `--toast-index`, `--toasts-before` (count in front = newer), `--toast-offset` (px, sum of front heights + gaps when expanded, else `front * COLLAPSED_PEEK`), `--toast-height` (own measured px), `data-front` (on index 0), `data-expanded`, and `data-front-count`/visibility hint via `--toasts-before`. Heights register via `ResizeObserver` when available, else a one-time `getBoundingClientRect` on mount.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import { ToastRoot, ToastTitle } from '../toast/toast-parts.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';

afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  cleanup();
});

function App() {
  return (
    <Toaster expand={false}>
      {(t) => (
        <ToastRoot toast={t} data-testid={`root-${t.id}`}>
          <ToastTitle />
        </ToastRoot>
      )}
    </Toaster>
  );
}

describe('toast stacking attributes', () => {
  it('marks the newest toast as front and sets index vars', () => {
    const { getByTestId } = render(<App />);
    let a: string | number = '';
    let b: string | number = '';
    act(() => {
      a = toast('first');
    });
    act(() => {
      b = toast('second');
    });
    const front = getByTestId(`root-${b}`); // newest
    const back = getByTestId(`root-${a}`);
    expect(front.getAttribute('data-front')).toBe('');
    expect(front.style.getPropertyValue('--toasts-before')).toBe('0');
    expect(back.getAttribute('data-front')).toBeNull();
    expect(back.style.getPropertyValue('--toasts-before')).toBe('1');
    expect(back.style.getPropertyValue('--toast-index')).toBe('1');
  });

  it('toggles data-expanded on the toasts when the region is hovered', () => {
    const { getByTestId, getByRole } = render(<App />);
    let id: string | number = '';
    act(() => {
      id = toast('only');
    });
    const root = getByTestId(`root-${id}`);
    expect(root.getAttribute('data-expanded')).toBe('false');
    act(() => fireEvent.pointerEnter(getByRole('region')));
    expect(root.getAttribute('data-expanded')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-stacking.test.tsx`
Expected: FAIL (`--toasts-before` empty / `data-front` missing).

- [ ] **Step 3: Write minimal implementation**

In `toaster.tsx`, make the height registry and `expanded` live. Replace the `heights`/`registerHeight` block and the `expanded` value:

```tsx
  const heights = useRef(new Map<string | number, number>()).current;
  const [, bumpHeights] = useReducer((n: number) => n + 1, 0);
  const registerHeight = useCallback(
    (id: string | number, height: number) => {
      if (heights.get(id) === height) return;
      heights.set(id, height);
      bumpHeights();
    },
    [heights]
  );
```

Set `expanded: expand || hovered || focused` in the `ctx` memo (replace `expanded: expand`), and add `hovered`, `focused` to the dependency array. (`hovered`/`focused` already exist from Task 7.)

In `toast-parts.tsx`, extend `ToastRoot`. Add an import:

```tsx
import { useEffect, useMemo, useRef } from 'preact/hooks';
```

Replace the `ToastRoot` props-construction so it measures height and computes stacking vars. Inside `ToastRoot`, after `const toaster = useToasterContext('Root');` add:

```tsx
  const elRef = useRef<HTMLElement | null>(null);

  // Measure own height -> registry. ResizeObserver when present (content can
  // grow); otherwise a single mount measurement.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const measure = () => toaster.registerHeight(record.id, el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [toaster, record.id]);

  // Position among undismissed toasts (newest first). `before` = toasts in front.
  const undismissed = toaster.orderedIds.filter((id) => {
    if (id === record.id) return true;
    return true;
  });
  const index = toaster.orderedIds.indexOf(record.id);
  const before = index; // newest-first: lower index = more toward the front
  const COLLAPSED_PEEK = 16;
  let offset = 0;
  if (toaster.expanded) {
    for (let i = 0; i < before; i += 1) {
      offset += (toaster.heights.get(toaster.orderedIds[i]) ?? 0) + toaster.gap;
    }
  } else {
    offset = before * COLLAPSED_PEEK;
  }
  const ownHeight = toaster.heights.get(record.id) ?? 0;
```

Note: remove the throwaway `undismissed` block if the linter flags it; it is illustrative. The store already excludes nothing here, so use `toaster.orderedIds` directly. Final code uses only `index`/`before`.

Then change the `props` object passed to `renderElement` in `ToastRoot` to include the stacking attributes and a merged `style`:

```tsx
      props: {
        ...rest,
        ref: mergeRefs(
          ref,
          (node: HTMLElement | null) => {
            elRef.current = node;
          },
          rest.ref as Parameters<typeof mergeRefs>[0]
        ),
        role: 'listitem',
        'data-type': record.type,
        'data-state': open ? 'open' : 'closed',
        'data-expanded': toaster.expanded ? 'true' : 'false',
        'data-front': before === 0 ? '' : undefined,
        style: {
          ...(rest.style as JSX.CSSProperties | undefined),
          '--toast-index': String(index),
          '--toasts-before': String(before),
          '--toast-offset': `${offset}px`,
          '--toast-height': `${ownHeight}px`,
          '--toasts-visible': String(toaster.visibleToasts),
        },
      },
```

Confirm `mergeRefs` accepts three refs (it merges a variadic list; check `../merge-refs.js`). If it is strictly binary, nest: `mergeRefs(ref, mergeRefs(elNodeRef, rest.ref))`. Use whichever the signature supports.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-stacking.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/toaster.tsx packages/ui/src/toast/toast-parts.tsx packages/ui/src/__tests__/toast-stacking.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): toast stacking vars (index/offset/height) + expand on hover

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Swipe-to-dismiss

**Files:**
- Create: `packages/ui/src/toast/use-toast-swipe.ts`
- Modify: `packages/ui/src/toast/toast-parts.tsx` (`ToastRoot` wires the swipe hook; pause timer while swiping)
- Test: `packages/ui/src/__tests__/toast-swipe.test.tsx`

**Interfaces:**
- Consumes: `ToastPosition`, `useToasterContext`.
- Produces: `useToastSwipe(opts: { position; onDismiss; disabled? }): { swiping: boolean; amount: number; handlers }` where `handlers` are `onPointerDown`/`onPointerMove`/`onPointerUp`/`onPointerCancel` for the Root element. Axis and sign derive from `position`. Past `SWIPE_THRESHOLD` on release -> `onDismiss()`; below -> snap to 0. `ToastRoot` sets `data-swiping` and `--toast-swipe-amount` from the hook and pauses its timer while swiping.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import { ToastRoot, ToastTitle } from '../toast/toast-parts.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';
import { installReducedMotion } from './presence-helpers.js';

let restore: (() => void) | undefined;
afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  restore?.();
  restore = undefined;
  cleanup();
});

function App() {
  return (
    <Toaster position="bottom-right">
      {(t) => (
        <ToastRoot toast={t} data-testid={`root-${t.id}`}>
          <ToastTitle />
        </ToastRoot>
      )}
    </Toaster>
  );
}

// happy-dom does not implement setPointerCapture; stub it so the handlers run.
function stubCapture(el: Element) {
  // eslint-disable-next-line no-param-reassign
  (el as unknown as { setPointerCapture: () => void }).setPointerCapture =
    () => undefined;
  (el as unknown as { releasePointerCapture: () => void }).releasePointerCapture =
    () => undefined;
}

describe('toast swipe-to-dismiss', () => {
  it('dismisses when dragged past the threshold (right position -> swipe right)', () => {
    restore = installReducedMotion(true);
    const { getByTestId } = render(<App />);
    let id: string | number = '';
    act(() => {
      id = toast('Swipe me');
    });
    const root = getByTestId(`root-${id}`);
    stubCapture(root);
    act(() => fireEvent.pointerDown(root, { clientX: 0, clientY: 0, pointerId: 1 }));
    act(() => fireEvent.pointerMove(root, { clientX: 120, clientY: 0, pointerId: 1 }));
    expect(root.getAttribute('data-swiping')).toBe('true');
    act(() => fireEvent.pointerUp(root, { clientX: 120, clientY: 0, pointerId: 1 }));
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('snaps back when released below the threshold', () => {
    restore = installReducedMotion(true);
    const { getByTestId } = render(<App />);
    let id: string | number = '';
    act(() => {
      id = toast('Stay');
    });
    const root = getByTestId(`root-${id}`);
    stubCapture(root);
    act(() => fireEvent.pointerDown(root, { clientX: 0, clientY: 0, pointerId: 1 }));
    act(() => fireEvent.pointerMove(root, { clientX: 10, clientY: 0, pointerId: 1 }));
    act(() => fireEvent.pointerUp(root, { clientX: 10, clientY: 0, pointerId: 1 }));
    expect(toastStore.toasts).toHaveLength(1);
    expect(root.getAttribute('data-swiping')).toBe('false');
    expect(root.style.getPropertyValue('--toast-swipe-amount')).toBe('0px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-swipe.test.tsx`
Expected: FAIL (cannot find module `../toast/use-toast-swipe.js`).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/toast/use-toast-swipe.ts
import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ToastPosition } from './toast-store.js';

// Drag distance (px) past which a release dismisses the toast.
const SWIPE_THRESHOLD = 45;

type Axis = 'x' | 'y';

// Which way a toast is swiped to dismiss, given the region corner. Right-anchored
// toasts swipe right (+x); left-anchored swipe left (-x); centered toasts swipe
// toward their nearest edge (down for bottom, up for top).
function axisAndSign(position: ToastPosition): { axis: Axis; sign: number } {
  if (position.endsWith('right')) return { axis: 'x', sign: 1 };
  if (position.endsWith('left')) return { axis: 'x', sign: -1 };
  return { axis: 'y', sign: position.startsWith('top') ? -1 : 1 };
}

export interface UseToastSwipeOptions {
  position: ToastPosition;
  onDismiss: () => void;
  disabled?: boolean;
}

export interface UseToastSwipeResult {
  swiping: boolean;
  amount: number;
  handlers: Pick<
    JSX.HTMLAttributes<HTMLElement>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
  >;
}

export function useToastSwipe(
  opts: UseToastSwipeOptions
): UseToastSwipeResult {
  const { position, onDismiss, disabled = false } = opts;
  const [swiping, setSwiping] = useState(false);
  const [amount, setAmount] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const { axis, sign } = axisAndSign(position);

  const delta = (event: { clientX: number; clientY: number }) => {
    if (!start.current) return 0;
    const raw =
      axis === 'x'
        ? event.clientX - start.current.x
        : event.clientY - start.current.y;
    // Only motion toward the dismiss direction counts; clamp the rest to 0.
    return Math.max(0, raw * sign);
  };

  const onPointerDown = (event: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (disabled || event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY };
    setSwiping(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (!start.current) return;
    setAmount(delta(event));
  };

  const finish = (event: JSX.TargetedPointerEvent<HTMLElement>) => {
    if (!start.current) return;
    const moved = delta(event);
    start.current = null;
    setSwiping(false);
    setAmount(0);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (moved >= SWIPE_THRESHOLD) onDismiss();
  };

  return {
    swiping,
    amount,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
```

In `toast-parts.tsx`, wire the swipe hook into `ToastRoot`. Add the import:

```tsx
import { useToastSwipe } from './use-toast-swipe.js';
```

Inside `ToastRoot`, after the stacking computations, add:

```tsx
  const swipe = useToastSwipe({
    position: toaster.position,
    onDismiss: () => toastStore.dismiss(record.id, 'user'),
    disabled: record.dismissed,
  });
```

Update the timer's `paused` to also pause while swiping:

```tsx
    paused: toaster.paused || record.dismissed || swipe.swiping,
```

Add the swipe handlers, `data-swiping`, and `--toast-swipe-amount` to the `props` object (merge handlers and the style var):

```tsx
        ...swipe.handlers,
        'data-swiping': swipe.swiping ? 'true' : 'false',
        style: {
          ...(rest.style as JSX.CSSProperties | undefined),
          '--toast-index': String(index),
          '--toasts-before': String(before),
          '--toast-offset': `${offset}px`,
          '--toast-height': `${ownHeight}px`,
          '--toasts-visible': String(toaster.visibleToasts),
          '--toast-swipe-amount': `${swipe.amount}px`,
        },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/toast-swipe.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/toast/use-toast-swipe.ts packages/ui/src/toast/toast-parts.tsx packages/ui/src/__tests__/toast-swipe.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): swipe-to-dismiss with position-derived axis and threshold

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Barrel exports + drift gate

**Files:**
- Create: `packages/ui/src/toast/index.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/__tests__/exports.test.ts`

**Interfaces:**
- Consumes: everything built so far.
- Produces: from `hono-preact-ui`, the flat exports `ToastRoot/ToastTitle/ToastDescription/ToastAction/ToastClose`, `Toaster`, `toast`, the `Toast` namespace (`{ Root, Title, Description, Action, Close }`), and the public types (`ToasterProps`, `ToastRootProps`, `ToastTitleProps`, `ToastDescriptionProps`, `ToastActionProps`, `ToastCloseProps`, `ToastRecord`, `ToastOptions`, `ToastType`, `ToastPosition`, `ToastAction`).

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/src/__tests__/exports.test.ts` (append a new `describe`):

```ts
import * as ui2 from '../index.js';

describe('Toast exports', () => {
  it('exposes the imperative toast fn with its variants', () => {
    expect(typeof ui2.toast).toBe('function');
    for (const k of [
      'success',
      'error',
      'info',
      'warning',
      'loading',
      'custom',
      'promise',
      'dismiss',
    ]) {
      expect(typeof (ui2.toast as Record<string, unknown>)[k]).toBe('function');
    }
  });

  it('exposes Toaster and the Toast namespace', () => {
    expect(typeof ui2.Toaster).toBe('function');
    for (const part of ['Root', 'Title', 'Description', 'Action', 'Close']) {
      expect(typeof (ui2.Toast as Record<string, unknown>)[part]).toBe(
        'function'
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/ui/src/__tests__/exports.test.ts`
Expected: FAIL (`ui2.toast` undefined).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/toast/index.ts
export { toast } from './toast.js';
export { Toaster, type ToasterProps } from './toaster.js';
export {
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
  type ToastRootProps,
  type ToastTitleProps,
  type ToastDescriptionProps,
  type ToastActionProps,
  type ToastCloseProps,
} from './toast-parts.js';
export {
  type ToastRecord,
  type ToastOptions,
  type ToastType,
  type ToastPosition,
  type ToastAction as ToastActionData,
} from './toast-store.js';

import {
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
} from './toast-parts.js';

export const Toast = {
  Root: ToastRoot,
  Title: ToastTitle,
  Description: ToastDescription,
  Action: ToastAction,
  Close: ToastClose,
};
```

Note: the `ToastAction` *data* type is re-exported as `ToastActionData` to avoid colliding with the `ToastAction` *component*. Verify no other public name expects `ToastAction` to be the data type; the component wins the bare name.

Append to `packages/ui/src/index.ts`:

```ts
export {
  toast,
  Toaster,
  Toast,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
  type ToasterProps,
  type ToastRootProps,
  type ToastTitleProps,
  type ToastDescriptionProps,
  type ToastActionProps,
  type ToastCloseProps,
  type ToastRecord,
  type ToastOptions,
  type ToastType,
  type ToastPosition,
  type ToastActionData,
} from './toast/index.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/ui/src/__tests__/exports.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the package, then commit**

```bash
pnpm --filter hono-preact-ui build
git add packages/ui/src/toast/index.ts packages/ui/src/index.ts packages/ui/src/__tests__/exports.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): export toast surface (toast fn, Toaster, Toast namespace)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `pnpm build` (tsc) succeeds with no type errors. If `tsc` reports an error, fix it before committing (typecheck is a CI gate).

---

### Task 12: Live demo component + demo CSS

**Files:**
- Create: `apps/site/src/components/docs/ToastDemo.tsx`
- Modify: `apps/site/src/styles/root.css` (append `.docs-toast*` rules)
- Test: `apps/site/src/components/docs/__tests__/toast-demo.test.tsx` (only if the site has a component-test setup; otherwise verify via the site build in Task 14)

**Interfaces:**
- Consumes: the public `hono-preact-ui` toast surface.
- Produces: a `ToastDemo` default export rendering a few buttons (`toast`, `toast.success`, `toast.error`, `toast.promise`) and one `<Toaster>` wired with `Toast.*` parts and `.docs-toast*` classes. Conformant app code: `preact`/`preact/hooks` + `hono-preact-ui` imports only, no casts.

- [ ] **Step 1: Write the demo component**

```tsx
// apps/site/src/components/docs/ToastDemo.tsx
import {
  toast,
  Toaster,
  Toast,
  type ToastRecord,
} from 'hono-preact-ui';

function renderToast(t: ToastRecord) {
  return (
    <Toast.Root toast={t} class="docs-toast">
      <div class="docs-toast-body">
        <Toast.Title class="docs-toast-title" />
        <Toast.Description class="docs-toast-description" />
      </div>
      <Toast.Action class="docs-toast-action" />
      <Toast.Close class="docs-toast-close" aria-label="Dismiss">
        x
      </Toast.Close>
    </Toast.Root>
  );
}

export default function ToastDemo() {
  return (
    <div class="docs-toast-demo">
      <div class="docs-toast-controls">
        <button class="docs-button" onClick={() => toast('Event saved')}>
          Default
        </button>
        <button
          class="docs-button"
          onClick={() =>
            toast.success('Profile updated', {
              description: 'Your changes are live.',
            })
          }
        >
          Success
        </button>
        <button
          class="docs-button"
          onClick={() =>
            toast.error('Upload failed', {
              action: { label: 'Retry', onClick: () => toast('Retrying...') },
            })
          }
        >
          Error + action
        </button>
        <button
          class="docs-button"
          onClick={() =>
            toast.promise(
              new Promise((res) => setTimeout(res, 1500)),
              {
                loading: 'Saving...',
                success: 'Saved!',
                error: 'Could not save',
              }
            )
          }
        >
          Promise
        </button>
      </div>
      <Toaster position="bottom-right">{renderToast}</Toaster>
    </div>
  );
}
```

- [ ] **Step 2: Append the demo CSS**

Append to `apps/site/src/styles/root.css`. Transitions are guarded behind `@media (prefers-reduced-motion: no-preference)` so reduced-motion users get instant placement. The region is `position: fixed` as a visual default for the docs chrome; in a real browser the Popover API promotes it to the top layer (the `:popover-open` rule below covers both).

```css
/* Toast demo (docs chrome). Tokens: --foreground --muted --surface
   --border-color --accent --accent-foreground. */
.docs-toast-demo {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.docs-toast-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.docs-toast-demo .toaster,
.docs-toast-demo [popover] {
  position: fixed;
  inset: auto 1rem 1rem auto;
  width: min(22rem, calc(100vw - 2rem));
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  overflow: visible;
}
.docs-toast-demo ol {
  list-style: none;
  margin: 0;
  padding: 0;
}
.docs-toast {
  display: flex;
  align-items: start;
  gap: 0.75rem;
  box-sizing: border-box;
  width: 100%;
  padding: 0.875rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 0.625rem;
  background: var(--surface);
  color: var(--foreground);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
  transform: translateX(var(--toast-swipe-amount, 0px))
    translateY(var(--toast-offset, 0px));
  touch-action: pan-y;
}
@media (prefers-reduced-motion: no-preference) {
  .docs-toast {
    transition:
      transform 0.3s ease,
      opacity 0.3s ease;
  }
}
.docs-toast[data-swiping='true'] {
  transition: none;
}
.docs-toast[data-state='closed'] {
  opacity: 0;
}
.docs-toast-body {
  flex: 1;
  min-width: 0;
}
.docs-toast-title {
  font-weight: 600;
}
.docs-toast-description {
  color: var(--muted);
  font-size: 0.875rem;
}
.docs-toast-action {
  align-self: center;
  padding: 0.25rem 0.625rem;
  border: 0;
  border-radius: 0.375rem;
  background: var(--accent);
  color: var(--accent-foreground);
  cursor: pointer;
}
.docs-toast-close {
  align-self: start;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  line-height: 1;
}
.docs-toast[data-type='success'] {
  border-color: color-mix(in oklab, var(--accent) 50%, var(--border-color));
}
.docs-toast[data-type='error'] {
  border-color: color-mix(in oklab, #ef4444 60%, var(--border-color));
}
```

- [ ] **Step 3: Verify it type-checks and builds**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm --filter site build`
Expected: the site builds; `ToastDemo.tsx` resolves the toast exports from the freshly built `hono-preact-ui` dist. (If the build cannot resolve `hono-preact-ui` toast exports, Task 11's `pnpm build` did not run; rebuild the ui package.)

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/components/docs/ToastDemo.tsx apps/site/src/styles/root.css
git commit -m "$(cat <<'EOF'
docs(site): live Toast demo component and demo styles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Docs page + nav entry

**Files:**
- Create: `apps/site/src/pages/docs/components/toast.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts`
- Verify: `apps/site/src/pages/docs/__tests__` (route-nav parity)

**Interfaces:**
- Consumes: `ToastDemo`, `Example`, `CodeTabs`.
- Produces: the `/docs/components/toast` page and its nav entry in the `Overlays` section.

- [ ] **Step 1: Write the MDX page**

Follow the `add-docs-page` Component template (lead -> Demo -> Usage -> Styling -> API reference -> Accessibility). Read `apps/site/src/pages/docs/components/tooltip.mdx` first to match the exact import paths and `<CodeTabs>`/`<Example>` usage, then create `toast.mdx`:

````mdx
import Example from '../../../components/docs/Example.js';
import CodeTabs from '../../../components/docs/CodeTabs.js';
import ToastDemo from '../../../components/docs/ToastDemo.js';

# Toast

Imperative, accessible toast notifications. Fire one from anywhere with
`toast(...)`; render them through the headless `Toast.*` parts. Ships unstyled:
style everything through the `data-*` and CSS-variable contract.

## Demo

<Example>
  <ToastDemo />
</Example>

## Usage

```tsx
import { toast, Toaster, Toast, type ToastRecord } from 'hono-preact-ui';

function renderToast(t: ToastRecord) {
  return (
    <Toast.Root toast={t}>
      <Toast.Title />
      <Toast.Description />
      <Toast.Action />
      <Toast.Close aria-label="Dismiss">x</Toast.Close>
    </Toast.Root>
  );
}

export function App() {
  return (
    <>
      <button onClick={() => toast.success('Saved')}>Save</button>
      <Toaster position="bottom-right">{renderToast}</Toaster>
    </>
  );
}
```

Fire toasts imperatively:

```ts
toast('Event saved');
toast.success('Profile updated', { description: 'Your changes are live.' });
toast.error('Upload failed');
toast.promise(save(), { loading: 'Saving...', success: 'Saved!', error: 'Failed' });
const id = toast.loading('Working...');
toast.dismiss(id);
```

## Styling

The wrapper sets `data-state`, `data-type`, `data-position`, `data-expanded`,
`data-front`, `data-swiping`, and the `--toast-offset` / `--toast-height` /
`--toasts-before` / `--toast-swipe-amount` variables. Drive all motion from
those, and guard transitions behind `prefers-reduced-motion`.

<CodeTabs labels={['CSS', 'Tailwind']}>

```css
.toast {
  transform: translateX(var(--toast-swipe-amount, 0px))
    translateY(var(--toast-offset, 0px));
}
@media (prefers-reduced-motion: no-preference) {
  .toast {
    transition: transform 0.3s ease, opacity 0.3s ease;
  }
}
.toast[data-swiping='true'] {
  transition: none;
}
.toast[data-state='closed'] {
  opacity: 0;
}
```

```tsx
// Base Tailwind v4. Motion via the motion-safe: variant so reduced-motion
// users get instant placement.
<Toast.Root
  toast={t}
  class="motion-safe:transition-transform motion-safe:duration-300 data-[state=closed]:opacity-0"
  style={{
    transform:
      'translateX(var(--toast-swipe-amount,0px)) translateY(var(--toast-offset,0px))',
  }}
/>
```

</CodeTabs>

## API reference

### `toast`

| Call | Returns | Description |
| --- | --- | --- |
| `toast(message, opts?)` | `id` | Default toast. |
| `toast.success / error / info / warning / loading(message, opts?)` | `id` | Typed variants; `error` announces assertively. |
| `toast.custom((id) => VNode, opts?)` | `id` | Render an arbitrary body. |
| `toast.promise(promise, { loading, success, error })` | `id` | One toast tracks a promise. |
| `toast.dismiss(id?)` | `void` | Dismiss one toast, or all when `id` is omitted. |

`opts`: `id`, `description`, `duration` (ms; `Infinity` = sticky; default 4000),
`important`, `action: { label, onClick }`, `onDismiss`, `onAutoClose`.

### `Toaster`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `position` | `ToastPosition` | `'bottom-right'` | Corner; sets entry direction and swipe axis. |
| `label` | `string` | `'Notifications'` | Accessible name of the region. |
| `expand` | `boolean` | `false` | Always-expanded stack vs collapse-to-pile. |
| `visibleToasts` | `number` | `3` | Toasts shown before older ones fade under. |
| `gap` | `number` | `14` | Px gap between expanded toasts. |
| `hotkey` | `string[]` | `['altKey','KeyT']` | Chord that focuses the region. |
| `children` | `(t: ToastRecord) => VNode` | required | Render prop for each toast. |

### `Toast.Root`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `toast` | `ToastRecord` | required | The record from the render prop. |
| `render` | `RenderProp` | undefined | Replace the rendered element. |

`Toast.Title`, `Toast.Description`, `Toast.Action`, and `Toast.Close` each accept
the standard `render` prop and read the active toast from context; `Description`
and `Action` render nothing when the record has no description / action.

## Accessibility

`<Toaster>` mounts a separate, always-present visually-hidden announcer: polite
(`role=status`) for normal toasts and assertive (`role=alert`) for `error` or
`important` toasts. The visible list is a labeled `region` landmark of `<ol>`
items and is intentionally not itself a live region (so reflow never
re-announces). Press the `hotkey` (default Alt+T) to move focus into the region.
Hovering or focusing the region pauses auto-dismiss and expands the stack.
Motion is driven entirely by your CSS, so guarding transitions behind
`prefers-reduced-motion` yields an accessible, reduced-motion-correct result.

> Toast requires the browser Popover API to place its region in the top layer.
> This is a deliberate, documented exception to the library's
> progressive-enhancement baseline; all current browser versions support it.
````

- [ ] **Step 2: Add the nav entry**

Read `apps/site/src/pages/docs/nav.ts`, find the `Overlays` section in the `components` area, and add after the Tooltip/Menu entries:

```ts
{ title: 'Toast', route: '/docs/components/toast' },
```

- [ ] **Step 3: Run the route-nav parity test**

Run: `pnpm exec vitest run apps/site/src/pages/docs/__tests__`
Expected: PASS (every nav entry resolves to a real page and vice versa).

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs/components/toast.mdx apps/site/src/pages/docs/nav.ts
git commit -m "$(cat <<'EOF'
docs(site): Toast component page and nav entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Size-table config, baselines, and full CI-mirror verification

**Files:**
- Modify: `scripts/client-size-config.mjs`
- Modify (generated): `client-size-report.json`, `client-size-history.jsonl`

**Interfaces:**
- Consumes: the built `packages/ui/dist`.
- Produces: a `toast` row in the component size table and refreshed baselines; a fully green CI-mirror run.

- [ ] **Step 1: Add the size-table + chunk-bucket entries**

In `scripts/client-size-config.mjs`, add `toast` to `COMPONENT_MODULES`:

```js
  toast: ['toast/index.js'],
```

and add the docs-chunk prefix to `CHUNK_PREFIXES` (so the toast docs-page chunk buckets under `components`, matching the other component pages):

```js
  ['toast', 'components'],
```

Match the exact surrounding syntax of each array/object (read the file first; copy the punctuation style of the neighboring `menu`/`tooltip` entries).

- [ ] **Step 2: Regenerate the baselines**

Run from the repo root (rebuild ui first so the measurement reads current dist):

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
node scripts/measure-client-size.mjs --append-history
```

Expected: `client-size-report.json` gains a `toast` entry under `sectionC`; `client-size-history.jsonl` gets a new row. (Use the exact measure command the repo uses; if `package.json` defines a script like `pnpm size` or `pnpm measure:size`, use that instead. Read `scripts/measure-client-size.mjs`'s argv handling to confirm the `--append-history` flag name.)

- [ ] **Step 3: Run the full CI mirror**

Run from the repo root, in order:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all six pass. If `format:check` fails, run `pnpm format`, re-stage, and amend or add a follow-up commit. `.css` is not formatted by `format:check`, so eyeball the demo CSS. If `test:coverage` surfaces a coverage threshold miss on the new files, add the missing assertion to the relevant toast test (do not lower the threshold).

- [ ] **Step 4: Commit**

```bash
git add scripts/client-size-config.mjs client-size-report.json client-size-history.jsonl
git commit -m "$(cat <<'EOF'
chore(metrics): add toast to component size table + baselines

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Final verification statement**

Confirm and report: all six CI-mirror steps passed, the full toast test suite is green (`pnpm exec vitest run packages/ui/src/__tests__/toast-*.test.ts packages/ui/src/__tests__/toaster-*.test.ts packages/ui/src/__tests__/exports.test.ts`), and `git status` is clean. Do not claim completion without pasting the passing output of the six steps.

---

## Self-Review

**Spec coverage** (each spec section maps to a task):

- Store + singleton + SSR safety -> Task 1, Task 5 (SSR test).
- Imperative API (`toast` + variants + custom + dismiss) -> Task 2; `promise` -> Task 3.
- Compound parts + `data-*`/CSS-var contract -> Tasks 6, 9, 10.
- Announcer (pre-mounted, polite/assertive) -> Task 4, wired in Task 5.
- Region landmark + `<ol>/<li>` + top-layer popover -> Task 5.
- Keyboard/focus (hotkey, pause on hover/focus) -> Tasks 7, 8; focus-preservation-on-dismiss is covered structurally (focus stays in the region's `<ol>`; an explicit move-focus-to-next test is a recommended addition if Task 8 is extended, noted below).
- Reduced motion -> reused via `usePresence` (Task 6 test uses `installReducedMotion`) and the demo CSS `@media` guard (Task 12).
- Positions -> Task 5 (`data-position`) + Task 10 (swipe axis).
- Stacking expand/collapse + reflow -> Task 9 (vars) + Task 12 CSS (transition-driven reflow).
- Swipe -> Task 10.
- Timers/pause -> Task 7.
- Tests matrix -> Tasks 1-10 each ship their test; exports drift -> Task 11.
- Docs/demo/size table -> Tasks 12, 13, 14.
- Browser-support exception documented -> Task 13 MDX callout.

**Gap noted:** the spec's "dismissing the focused toast moves focus to the next toast or the region" is implemented implicitly (focus lives inside the region landmark) but has no dedicated test. If the reviewer wants it enforced, add a focus-management step to Task 8 with a test that tabs to a `Toast.Close`, dismisses, and asserts `document.activeElement` is still within the region. Left out of the core path to avoid over-engineering the prototype; flagged here rather than silently dropped.

**Placeholder scan:** no `TODO`/`TBD`; every code step shows complete code. The two "read the neighboring file first" notes (Task 13 nav shape, Task 14 config syntax) are deliberate (exact surrounding punctuation must be copied), not placeholders, and each gives the exact line to add.

**Type consistency:** `ToastRecord`, `ToastOptions`, `ToastInput`, `ToastPosition`, `DismissReason` are defined in Task 1 and used unchanged through Tasks 2-11. `registerHeight(id, height)`, `heights`, `orderedIds`, `expanded`, `paused` are declared on `ToasterContextValue` in Task 5 and made live in Tasks 7/9 with the same signatures. The data-type `ToastAction` is re-exported as `ToastActionData` (Task 11) to avoid colliding with the `ToastAction` component; both names are accounted for. `useToastTimer`, `useToastSwipe` signatures match between their defining task and their `ToastRoot` call sites.

**Cast audit (per Global Constraints):** three potential `as` seams are each given a no-cast reshape in the task text: the hotkey modifier set (Task 8, use the object form), the `ToastAction` DOM-event boundary (Task 6, retype `onClick` if it does not ripple), and the `'section' as string` tag (Task 5, lift to a const if flagged). The remaining `as` usages are reading off `rest.style`/`rest.ref` (structural prop reads) and the test-only capture stub, which are accepted boundaries.
