# Signals Always-On Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make signals the framework's always-on data layer: loaders and rooms are signal-backed and granular by default, with no `hono-preact/signals` opt-in and no non-signal path.

**Architecture:** Delete the registration seam and the signals-free default paths. Move the signal factories into two core-feature modules (`internal/roster-signal.ts`, `internal/loader-signal.ts`) that import `@preact/signals` directly, and have `use-room.ts` / `loader.tsx` / `define-loader.ts` import them directly. `@preact/signals` loads exactly when a loader or room is used. The observable behaviour is the already-tested Phase 1-2 signal path; the diff is mostly deletions of the default alternative. Done incrementally so the tree stays green: wire each consumer direct first (leaving the opt-in seam unused-but-present), then tear the seam and the `hono-preact/signals` subpath down last.

**Tech Stack:** Preact, `@preact/signals` (^2.9.4, now always-loaded for the data layer), TypeScript, Vitest, happy-dom, preact-render-to-string, pnpm workspaces.

## Global Constraints

- No em-dashes (U+2014) in prose, comments, or commit messages.
- No inline `as` casts where the type can be reshaped; acceptable only at JSON/FormData/user-module/structural-context boundaries.
- The **core `index.ts` graph must NOT reach `@preact/signals`.** Only the data-layer modules (`use-room` / loader) may. (This replaces the old "only signals.ts imports @preact/signals" rule.)
- Public API signatures unchanged: `useDataSignal`, `useFieldSignal`, `memberIds`, `member`, `useRoom`'s result all keep their shapes. Only the opt-in requirement and the internal dual path are removed.
- Behaviour must equal the Phase 1-2 signal-mode behaviour (the existing granularity / SSR / parity tests pin it).
- Run from the worktree root: `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/phase5-always-on`. Tests via `pnpm exec vitest run <path>`.
- After a removal, a repo-wide grep for the removed symbol must return zero non-test, non-comment hits before committing.

## File Structure

- `packages/iso/src/internal/roster-signal.ts` (create) - `createSignalRoster<S>()`, moved verbatim from `signals.ts`. Imports `@preact/signals`. Consumed by `use-room.ts`. (`realtime` bucket)
- `packages/iso/src/internal/loader-signal.ts` (create) - `createPhaseCell` + `derive`, moved from `signals.ts`. Imports `@preact/signals`. Consumed by `loader.tsx` / `define-loader.ts`. (`loaders` bucket)
- `packages/iso/src/use-room.ts` (modify) - direct `createSignalRoster`; delete the default path.
- `packages/iso/src/internal/loader.tsx` (modify) - direct `createPhaseCell`; delete the fallback.
- `packages/iso/src/define-loader.ts` (modify) - direct `derive`; delete the default branches.
- `packages/iso/src/internal/reactive.ts` (modify) - keep the structural types; delete the register/get + Impl types (Task 3).
- `packages/iso/src/signals.ts` (delete, Task 3), `packages/iso/src/internal/default-roster.ts` (delete, Task 1).
- Subpath teardown (Task 3): iso + hono-preact `package.json`, `packages/hono-preact/src/signals.ts`, `consolidate.mjs`, `vitest.config.ts`, `size-probe-config.mjs`, `AGENTS.md`, `agents-appendix.test.ts`, `exports.test.ts`.

---

### Task 1: Collapse the presence dual path

**Files:**
- Create: `packages/iso/src/internal/roster-signal.ts`
- Modify: `packages/iso/src/signals.ts` (import the moved factory)
- Modify: `packages/iso/src/use-room.ts`
- Delete: `packages/iso/src/internal/default-roster.ts`, `packages/iso/src/internal/__tests__/default-roster.test.ts`
- Modify tests: `packages/iso/src/internal/__tests__/use-room-signals-granularity.test.tsx`, `use-room-roster.test.tsx`, `presence-granularity.test.tsx`, `signal-roster.test.ts`

**Interfaces:**
- Produces: `createSignalRoster<S>(): RosterStore<S>` from `internal/roster-signal.js`.
- Consumes: `RosterStore`, `ReadonlyReactive` from `internal/reactive.js`; `PresenceMember` from `internal/room-envelope.js`; `signal`, `computed`, `Signal` from `@preact/signals`.

- [ ] **Step 1: Create `roster-signal.ts` by moving `createSignalRoster` out of `signals.ts`**

Create `packages/iso/src/internal/roster-signal.ts` with the exact body of `createSignalRoster` currently in `signals.ts` (lines ~17-71), plus its imports:

```ts
import { signal, computed, type Signal } from '@preact/signals';
import type { PresenceMember } from './room-envelope.js';
import type { ReadonlyReactive, RosterStore } from './reactive.js';

/**
 * The signal-backed roster: `member(id)` is a per-member signal, so a presence
 * update patches one bound row instead of re-rendering every consumer. This is
 * the always-on data-layer store for `useRoom`; `@preact/signals` loads with it.
 */
export function createSignalRoster<S>(): RosterStore<S> {
  const ids = signal<readonly string[]>([]);
  const byId = new Map<string, Signal<PresenceMember<S>>>();
  const absent = computed<PresenceMember<S> | undefined>(() => undefined);
  const members = computed<ReadonlyArray<PresenceMember<S>>>(() => {
    const out: PresenceMember<S>[] = [];
    for (const id of ids.value) {
      const s = byId.get(id);
      if (s) out.push(s.value);
    }
    return out;
  });

  return {
    snapshot(members) {
      byId.clear();
      // `[...byId.keys()]` dedupes a snapshot with a duplicate id.
      for (const m of members) byId.set(m.id, signal(m));
      ids.value = [...byId.keys()];
    },
    upsert(id, state) {
      const existing = byId.get(id);
      if (existing) {
        existing.value = { id, state }; // touch only this member's signal
        return;
      }
      byId.set(id, signal({ id, state }));
      ids.value = [...ids.value, id];
    },
    leave(id) {
      if (byId.delete(id)) {
        ids.value = ids.value.filter((x) => x !== id);
      }
    },
    memberIds: ids,
    members,
    member(id): ReadonlyReactive<PresenceMember<S> | undefined> {
      return byId.get(id) ?? absent;
    },
    dispose() {
      byId.clear();
      ids.value = [];
    },
  };
}
```

- [ ] **Step 2: Point `signals.ts` at the moved factory (keeps the opt-in entry green)**

In `packages/iso/src/signals.ts`, delete the local `createSignalRoster` function and import it instead. Change the top imports to drop `PresenceMember` (no longer used there) and add the roster import; change `installPresenceSignals` to reference the imported factory. The `Signal` type import stays only if still used by the loader factory (it is). Concretely, replace the removed function with:

```ts
import { createSignalRoster } from './internal/roster-signal.js';
```

and leave `installPresenceSignals` as `registerPresenceReactiveImpl({ createRoster: <S>() => createSignalRoster<S>() })`.

- [ ] **Step 3: Run the presence suite to confirm the move is behaviour-neutral**

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/signal-roster.test.ts packages/iso/src/internal/__tests__/presence-granularity.test.tsx packages/iso/src/internal/__tests__/use-room-signals-granularity.test.tsx`
Expected: all pass (the factory moved, still registered via the opt-in entry).

- [ ] **Step 4: Wire `use-room.ts` to `createSignalRoster` directly; delete the default path**

In `packages/iso/src/use-room.ts`:

Replace the imports of the reactive seam and default roster:

```ts
import { createSignalRoster } from './internal/roster-signal.js';
```

(remove the `getPresenceReactiveImpl` import from `./internal/reactive.js` and the `createDefaultRoster` import from `./internal/default-roster.js`; keep the `RosterStore` type import if still referenced, otherwise drop it.)

Replace the store-creation block:

```ts
  const membersRef = useRef(members);
  membersRef.current = members;

  const storeRef = useRef<{
    store: RosterStore<State<R> | undefined>;
    signalMode: boolean;
  } | null>(null);
  if (storeRef.current === null) {
    const impl = getPresenceReactiveImpl();
    storeRef.current = impl
      ? { store: impl.createRoster<State<R> | undefined>(), signalMode: true }
      : {
          store: createDefaultRoster<State<R> | undefined>(
            () => membersRef.current
          ),
          signalMode: false,
        };
  }
  const { store, signalMode } = storeRef.current;

  useEffect(() => () => store.dispose(), [store]);
```

with:

```ts
  const storeRef = useRef<RosterStore<State<R> | undefined> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createSignalRoster<State<R> | undefined>();
  }
  const store = storeRef.current;

  useEffect(() => () => store.dispose(), [store]);
```

Remove the now-unused `members` / `setMembers` `useState` and the `membersRef`. Change the state declaration block from:

```ts
  const [members, setMembers] = useState<
    ReadonlyArray<PresenceMember<State<R> | undefined>>
  >([]);
  const [selfId, setSelfId] = useState<string | undefined>(undefined);
```

to:

```ts
  const [selfId, setSelfId] = useState<string | undefined>(undefined);
```

(Keep `selfId` / `setSelfId`.)

In `onRawMessage`, drop the `if (!signalMode) setMembers(...)` lines, leaving only the `store.*` calls:

```ts
      if (env.t === 'snapshot') {
        setSelfId(env.self);
        store.snapshot(env.members);
        return;
      }
      if (env.t === 'presence') {
        if (env.op === 'leave') {
          store.leave(env.from);
        } else {
          store.upsert(env.from, env.state);
        }
        return;
      }
      opts?.onMessage?.(env.msg, env.from);
```

In the result object, the getters no longer branch on `signalMode`:

```ts
    get members() {
      return store.members.value;
    },
    memberIds: store.memberIds,
    member: store.member,
    get self() {
      const sid = selfIdRef.current;
      if (sid === undefined) return undefined;
      return store.member(sid).value;
    },
```

Delete the now-unused `upsertMember` helper at the bottom of the file (grep first: it should have no other callers).

- [ ] **Step 5: Delete the default roster and its test**

```bash
git rm packages/iso/src/internal/default-roster.ts packages/iso/src/internal/__tests__/default-roster.test.ts
```

- [ ] **Step 6: Adapt the presence tests to always-on (drop the opt-in scaffolding)**

- `use-room-signals-granularity.test.tsx`: remove `installPresenceSignals()` calls and the `registerPresenceReactiveImpl(null)` in `afterEach` and its import (the roster is always signal-backed now). The assertions are unchanged.
- `use-room-roster.test.tsx`: this tested the DEFAULT impl. Its behaviour assertions (memberIds/member track the wire) still hold with the signal store, but drop any default-mode-specific naming; keep the SSR-parity (empty roster first render) case. Remove `registerLoaderReactiveImpl`/presence registration scaffolding if present.
- `presence-granularity.test.tsx` and `signal-roster.test.ts`: these exercise the store directly; update their import of `createSignalRoster` from `../signals.js` / the registration to `../roster-signal.js` (direct), and drop `installPresenceSignals`/`registerPresenceReactiveImpl(null)`.

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/` (the whole internal suite)
Expected: green. If a test still imports `createDefaultRoster` or asserts default-mode coarseness, delete that case (the default path is gone by design).

- [ ] **Step 7: Grep, typecheck, commit**

Run: `rg -n "createDefaultRoster|getPresenceReactiveImpl|signalMode" packages/iso/src --glob '!**/__tests__/**'`
Expected: zero hits (presence side fully collapsed; the `getPresenceReactiveImpl`/`registerPresenceReactiveImpl` in `reactive.ts` and `signals.ts` remain until Task 3, so limit the grep to consumers; `getPresenceReactiveImpl` should now appear ONLY in `reactive.ts` (definition) and `signals.ts` is the only caller of `registerPresenceReactiveImpl`).
Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.

```bash
git add -A
git commit -m "feat(iso): always-on signal roster for useRoom; delete the default path

useRoom imports createSignalRoster directly (moved to internal/
roster-signal.ts). The signals-free default roster, the signalMode branch,
the useState members + setMembers path, and upsertMember are deleted. The
opt-in seam still exists (Task 3 removes it) but useRoom no longer uses it.
Behaviour equals the tested Phase 1 signal path."
```

---

### Task 2: Collapse the loader dual path

**Files:**
- Create: `packages/iso/src/internal/loader-signal.ts`
- Modify: `packages/iso/src/signals.ts` (import the moved factories)
- Modify: `packages/iso/src/internal/loader.tsx`, `packages/iso/src/define-loader.ts`
- Modify tests: `loader-data-signal-api.test.tsx`, `loader-signal-impl.test.ts`, `loader-field-granularity.test.tsx`, `loader-signal-ssr.test.tsx`, `loader-view-signal-context.test.tsx`

**Interfaces:**
- Produces: `createPhaseCell<T>(initial: T): PhaseCell<T>` and `derive<T, R>(source, select): ReadonlyReactive<R>` from `internal/loader-signal.js`.
- Consumes: `PhaseCell`, `ReadonlyReactive` from `internal/reactive.js`; `signal`, `computed` from `@preact/signals`.

- [ ] **Step 1: Create `loader-signal.ts` by moving the loader factories out of `signals.ts`**

Create `packages/iso/src/internal/loader-signal.ts`:

```ts
import { signal, computed } from '@preact/signals';
import type { ReadonlyReactive, PhaseCell } from './reactive.js';

/**
 * A phase cell mirroring one loader's projected `LoaderState`. The loader host
 * writes it each render (memoized value = no-op); `useDataSignal` reads `source`.
 * The always-on data-layer implementation for loaders.
 */
export function createPhaseCell<T>(initial: T): PhaseCell<T> {
  const s = signal(initial);
  return {
    set(value) {
      s.value = value;
    },
    source: s,
  };
}

/** A memoized projection off a reactive source (a `computed`). */
export function derive<T, R>(
  source: ReadonlyReactive<T>,
  select: (v: T) => R
): ReadonlyReactive<R> {
  return computed(() => select(source.value));
}
```

- [ ] **Step 2: Point `signals.ts` at the moved factories**

In `signals.ts`, delete the inline `createPhaseCell` / `derive` from `installLoaderSignals` and import them:

```ts
import { createPhaseCell, derive } from './internal/loader-signal.js';
```

and set `installLoaderSignals` to `registerLoaderReactiveImpl({ createPhaseCell, derive })`. If `@preact/signals`'s `signal`/`computed`/`Signal` imports in `signals.ts` are now unused (both factories moved out), remove them. Run `pnpm exec vitest run packages/iso/src/internal/__tests__/loader-signal-impl.test.ts` to confirm the opt-in entry still registers (green).

- [ ] **Step 3: Wire `loader.tsx` to `createPhaseCell` directly; delete the fallback**

In `packages/iso/src/internal/loader.tsx`, replace the import of `getLoaderReactiveImpl` (from `./reactive.js`) with:

```ts
import { createPhaseCell } from './loader-signal.js';
```

Replace the cell block:

```ts
  const viewCellRef = useRef<PhaseCell<
    LoaderState<T> | StreamState<T> | null
  > | null>(null);
  if (viewCellRef.current === null) {
    const impl = getLoaderReactiveImpl();
    if (impl)
      viewCellRef.current = impl.createPhaseCell<
        LoaderState<T> | StreamState<T> | null
      >(null);
  }
  const viewCell = viewCellRef.current;
  if (viewCell) viewCell.set(viewState);
  const viewSignal: ReadonlyReactive<LoaderState<T> | StreamState<T> | null> =
    viewCell ? viewCell.source : { value: viewState };
```

with:

```ts
  const viewCellRef = useRef<PhaseCell<
    LoaderState<T> | StreamState<T> | null
  > | null>(null);
  if (viewCellRef.current === null) {
    viewCellRef.current = createPhaseCell<
      LoaderState<T> | StreamState<T> | null
    >(null);
  }
  const viewCell = viewCellRef.current;
  viewCell.set(viewState);
  const viewSignal: ReadonlyReactive<LoaderState<T> | StreamState<T> | null> =
    viewCell.source;
```

The server `DataReader` provider still passes `{ value: state }` (a one-shot snapshot, unchanged); do NOT change it.

- [ ] **Step 4: Wire `define-loader.ts` to `derive` directly; delete the default branches**

In `define-loader.ts`, replace the `getLoaderReactiveImpl` import (from `./internal/reactive.js`) with:

```ts
import { derive } from './internal/loader-signal.js';
```

In `readDataSignal`, replace the impl branch:

```ts
    const impl = getLoaderReactiveImpl();
    const stateRef = useRef<ReadonlyReactive<LoaderState<unknown>> | null>(
      null
    );
    if (!impl) {
      return {
        get value() {
          return source.value ?? { status: 'loading' };
        },
      };
    }
    if (stateRef.current === null) {
      stateRef.current = impl.derive(source, (s) => s ?? { status: 'loading' });
    }
    return stateRef.current;
```

with:

```ts
    const stateRef = useRef<ReadonlyReactive<LoaderState<unknown>> | null>(
      null
    );
    if (stateRef.current === null) {
      stateRef.current = derive(source, (s) => s ?? { status: 'loading' });
    }
    return stateRef.current;
```

In `useFieldSignal`, replace:

```ts
      const impl = getLoaderReactiveImpl();
      const ref = useRef<ReadonlyReactive<R> | null>(null);
      const project = (s: LoaderState<unknown>): R =>
        s.status === 'loading' ? fallback : select(s.data);
      if (!impl) {
        return {
          get value() {
            return project(state.value);
          },
        };
      }
      if (ref.current === null) {
        ref.current = impl.derive(state, project);
      }
      return ref.current;
```

with:

```ts
      const ref = useRef<ReadonlyReactive<R> | null>(null);
      const project = (s: LoaderState<unknown>): R =>
        s.status === 'loading' ? fallback : select(s.data);
      if (ref.current === null) {
        ref.current = derive(state, project);
      }
      return ref.current;
```

- [ ] **Step 5: Adapt the loader tests to always-on**

- `loader-field-granularity.test.tsx`, `loader-signal-ssr.test.tsx`, `loader-view-signal-context.test.tsx`: remove `installLoaderSignals()` calls and `registerLoaderReactiveImpl(null)` `afterEach` + imports (the cell is always signal-backed now). Assertions unchanged.
- `loader-data-signal-api.test.tsx`: this file covered DEFAULT mode. Its first-render/settle behaviour still holds with the always-on signal cell. Keep the "settles to value" and "throws outside a `<Loader>`" cases; drop any assertion that was specifically about the default (non-signal) fresh-getter, since that path no longer exists. Remove the `registerLoaderReactiveImpl` scaffolding.
- `loader-signal-impl.test.ts`: retarget its imports from the registration (`getLoaderReactiveImpl().createRoster`/`createPhaseCell`) to the direct `createPhaseCell` / `derive` from `../loader-signal.js`.

Run: `pnpm exec vitest run packages/iso/src/internal/__tests__/ packages/iso/src/__tests__/`
Expected: green.

- [ ] **Step 6: Grep, typecheck, commit**

Run: `rg -n "getLoaderReactiveImpl" packages/iso/src --glob '!**/__tests__/**'`
Expected: hits ONLY in `reactive.ts` (definition) and `signals.ts` (caller). No consumer hits.
Run: `pnpm --filter '@hono-preact/iso' exec tsc --noEmit`
Expected: no errors.

```bash
git add -A
git commit -m "feat(iso): always-on loader signal cell; delete the default branches

loader.tsx and define-loader import createPhaseCell / derive directly
(moved to internal/loader-signal.ts). The getLoaderReactiveImpl
null-checks and the default-mode snapshot/fresh-getter fallbacks are
deleted. Behaviour equals the tested Phase 2 signal path."
```

---

### Task 3: Delete the seam and the `hono-preact/signals` subpath

**Files:**
- Delete: `packages/iso/src/signals.ts`, `packages/hono-preact/src/signals.ts`
- Modify: `packages/iso/src/internal/reactive.ts`, `packages/iso/package.json`, `packages/hono-preact/package.json`, `packages/hono-preact/scripts/consolidate.mjs`, `vitest.config.ts`, `scripts/size-probe-config.mjs`, `packages/create-hono-preact/templates/agents/AGENTS.md`, `packages/create-hono-preact/__tests__/agents-appendix.test.ts`, `packages/hono-preact/__tests__/exports.test.ts`
- Create: `packages/iso/src/internal/__tests__/signals-always-on.test.ts` (module-graph guard)

- [ ] **Step 1: Delete the opt-in entry files**

```bash
git rm packages/iso/src/signals.ts packages/hono-preact/src/signals.ts
```

- [ ] **Step 2: Remove the register/get seam from `reactive.ts`**

In `packages/iso/src/internal/reactive.ts`, KEEP `ReadonlyReactive`, `RosterStore`, `PhaseCell`. DELETE: `PresenceReactiveImpl`, `registerPresenceReactiveImpl`, `getPresenceReactiveImpl`, `presenceImpl`, `LoaderReactiveImpl`, `registerLoaderReactiveImpl`, `getLoaderReactiveImpl`, `loaderImpl`. Update the doc comments on the kept types to drop "opt-in" / "signals-free default" language (they are now the always-on data-layer contracts).

- [ ] **Step 3: Remove the subpath from the iso and hono-preact packages**

- `packages/iso/package.json`: delete the `"./signals"` export block.
- `packages/hono-preact/package.json`: delete the `"./signals"` export block. Keep `@preact/signals` in `dependencies` (now reached via the data-layer modules).
- `packages/hono-preact/scripts/consolidate.mjs`: delete the `'@hono-preact/iso/signals': 'iso/signals.js',` line from `DIST_PATHS`, and remove `iso/signals` from the import-rewrite regex alternation.
- `vitest.config.ts`: delete the two aliases (`'@hono-preact/iso/signals'` and `'hono-preact/signals'`).

- [ ] **Step 4: Remove the `signals` size bucket**

In `scripts/size-probe-config.mjs`, delete the `signals: ['signals.js'],` line from `FEATURE_MODULES`. Keep `@preact/signals` / `@preact/signals/*` in `EXTERNAL`.

- [ ] **Step 5: Remove the public-entry docs + gate entries**

- `packages/create-hono-preact/templates/agents/AGENTS.md`: delete the `hono-preact/signals` bullet.
- `packages/create-hono-preact/__tests__/agents-appendix.test.ts`: delete the `import * as signals from 'hono-preact/signals';` line and the `'hono-preact/signals': signals,` barrel entry.
- `packages/hono-preact/__tests__/exports.test.ts`: delete the entire `describe('hono-preact/signals export', ...)` block.

- [ ] **Step 6: Add the always-on module-graph guard**

Create `packages/iso/src/internal/__tests__/signals-always-on.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Static import-graph checks encoding the always-on invariant: the data-layer
// modules reach @preact/signals, and the seam / opt-in entry are gone.
const here = dirname(fileURLToPath(import.meta.url));
const iso = join(here, '..', '..'); // packages/iso/src

function reads(rel: string, needle: string): boolean {
  return readFileSync(join(iso, rel), 'utf8').includes(needle);
}

describe('signals are the always-on data layer', () => {
  it('the roster + loader signal modules import @preact/signals', () => {
    expect(reads('internal/roster-signal.ts', "'@preact/signals'")).toBe(true);
    expect(reads('internal/loader-signal.ts', "'@preact/signals'")).toBe(true);
  });

  it('useRoom / loader consume the signal factories directly (no registration seam)', () => {
    expect(reads('use-room.ts', 'createSignalRoster')).toBe(true);
    expect(reads('internal/loader.tsx', 'createPhaseCell')).toBe(true);
    expect(reads('define-loader.ts', 'derive')).toBe(true);
    // The removed seam is gone from reactive.ts.
    expect(reads('internal/reactive.ts', 'registerPresenceReactiveImpl')).toBe(
      false
    );
    expect(reads('internal/reactive.ts', 'getLoaderReactiveImpl')).toBe(false);
  });
});
```

- [ ] **Step 7: Grep, regenerate corpus, typecheck**

Run: `rg -n "hono-preact/signals|@hono-preact/iso/signals|registerPresenceReactiveImpl|getPresenceReactiveImpl|registerLoaderReactiveImpl|getLoaderReactiveImpl|installPresenceSignals|installLoaderSignals" packages scripts --glob '!**/dist/**' --glob '!**/*.md'`
Expected: zero hits (all torn down; docs/specs may still mention it in prose which is fine, hence excluding `*.md` design docs; the AGENTS.md template is not a design doc and was edited in Step 5, confirm it too).
Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Run: `pnpm gen:agents-corpus`
Run: `pnpm typecheck`
Expected: all clean.

- [ ] **Step 8: Full verification and size**

Run each and confirm pass:
```bash
pnpm format:check   # if it fails: pnpm format, then re-check
pnpm test:types
pnpm test
pnpm test:integration
pnpm --filter site build
```
Then measure:
```bash
node scripts/measure-framework-size.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).sectionA;console.log('core:',a.core.total,'| realtime:',a.realtime.total,'| loaders:',a.loaders.total,'| signals bucket:',a.signals?.marginal ?? '(removed)');})"
```
Expected: core unchanged (~5,521 B); no `signals` bucket; realtime / loaders roughly flat or slightly smaller (default-path code deleted). Note the numbers for the PR (do NOT edit the umbrella charter here). The honest floor line for the PR: a data-layer app now ships `@preact/signals` (~3.3 kB gz) unconditionally.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(iso): remove the opt-in signals seam and hono-preact/signals subpath

Signals are now the always-on data layer: the registration seam
(register/get + Impl types), the opt-in entry (signals.ts), and the
hono-preact/signals public subpath and all its wiring (exports,
consolidate map, vitest aliases, size bucket, AGENTS appendix, exports
test) are deleted. A module-graph guard pins the invariant: the data-layer
modules reach @preact/signals, the seam is gone, core stays signals-free."
```

---

## Self-Review

**Spec coverage:**
- Direct-import factories, no seam/boot install (spec §2) -> Tasks 1-2 (create modules, wire consumers) + Task 3 (delete seam).
- File plan / new modules (spec §3) -> `roster-signal.ts` (Task 1), `loader-signal.ts` (Task 2).
- Delete default paths + `default-roster` + branches (spec §3) -> Tasks 1-2.
- Subpath teardown (spec §4) -> Task 3 Steps 1, 3, 4, 5.
- SSR unchanged (spec §5) -> the `DataReader` `{ value: state }` provider is explicitly left untouched (Task 2 Step 3); SSR tests kept.
- Size (spec §6) -> Task 3 Step 8.
- Charter (spec §7) -> updated at umbrella-merge time, NOT on this branch (noted in Task 3 Step 8).
- Testing (spec §8) -> tests adapted in Tasks 1-2; module-graph guard in Task 3 Step 6; full suite Task 3 Step 8.
- Scope excludes Phase 3/4 (spec §9) -> no store/optimistic/`<For>` work here.
- Risks (spec §10) -> the required grep-for-removed-symbol steps (Task 1 Step 7, Task 2 Step 6, Task 3 Step 7); the module-graph guard covers the options-patch-load-site risk.

**Placeholder scan:** No TBD/TODO; every edit shows the exact before/after code. Test-adaptation steps name the specific files and what to drop, with a rule ("delete the default-mode case") rather than a placeholder.

**Type consistency:** `createSignalRoster(): RosterStore<S>`, `createPhaseCell<T>(initial): PhaseCell<T>`, `derive<T,R>(source, select): ReadonlyReactive<R>` match between the new modules (Tasks 1-2) and their consumers. `RosterStore` / `PhaseCell` / `ReadonlyReactive` are unchanged in `reactive.ts` (only the register/get + Impl types are removed in Task 3).
