import { signal, computed, useComputed, useSignal } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';

/**
 * A settable module-store cell backed by a signal. The store module writes via
 * `set`; consumers read the `readonly` signal (directly, or through a
 * `useStoreValue` projection). This is the sanctioned `@preact/signals` importer
 * for the action / form / optimistic stores, so those store modules stay free
 * of a direct `@preact/signals` value import (the module-graph guard).
 */
export type StoreSignal<T> = {
  readonly signal: ReadonlySignal<T>;
  set(value: T): void;
};

export function createStoreSignal<T>(initial: T): StoreSignal<T> {
  const s = signal<T>(initial);
  return {
    signal: s,
    set(value: T) {
      s.value = value;
    },
  };
}

/**
 * A component-scoped reactive projection of store signals: read any store
 * `.value`s inside `project` and this returns a `ReadonlySignal<R>` that a
 * binding tracks, so a consumer updates on a store change without the host
 * re-rendering. Routing store reads through this keeps the consumer hooks
 * (`useActionResult`, `useFormStatus`, ...) free of a direct `@preact/signals`
 * value import, so `@preact/signals` stays confined to the factory modules.
 */
export function useStoreValue<R>(project: () => R): ReadonlySignal<R> {
  return useComputed(project);
}

/**
 * A component-scoped (not module-level) settable signal: `useSignal` creates
 * it once for the component instance and persists it across renders. This is
 * the per-call-site counterpart to `createStoreSignal`'s module-level store,
 * for hooks that need a mutable signal cell scoped to one hook call (e.g.
 * `useOptimistic`'s queue) without importing `@preact/signals` directly.
 *
 * The field is named `signal` (matching `StoreSignal.signal`), not `value`,
 * so a caller reading the underlying signal's own value writes
 * `state.signal.value`, not the `state.value.value` stutter a `value` field
 * would produce.
 */
export function useStoreState<T>(initial: T): {
  readonly signal: ReadonlySignal<T>;
  set(next: T): void;
} {
  const s = useSignal(initial);
  return {
    signal: s,
    set(next: T) {
      s.value = next;
    },
  };
}

/**
 * A per-field granular error store: `fieldError(name)` is a per-field signal,
 * so a `<FieldError name="x">` re-renders only when field `x`'s own errors
 * change, mirroring `roster-signal.ts`'s `member(id)` / `members` split. The
 * shape uses `Record<string, string[]>` structurally (not `FieldErrorsMap`
 * by name) so this factory module stays self-contained; `field-errors-context
 * .ts` re-exports it under the `FieldErrorsMap`-flavored name.
 *
 * Unlike the roster (whose `member(id)` is only ever called for ids already
 * known to be present), `fieldError(name)` here may be called for a field
 * that has never had an error yet -- a `<FieldError name="x">` renders for
 * every field unconditionally, ready to show an error the moment one
 * appears. So `fieldError` get-or-creates the field's signal on first read
 * rather than falling back to a shared static "absent" signal: a shared
 * fallback would never notify that reader once the field's own signal is
 * later created by `setAll`.
 */
export type FieldErrorStore = {
  /** Replace the whole error set. Touches (and notifies) only the per-field
   * signals whose messages actually changed, and only fields that gained,
   * lost, or changed their messages -- a sibling field's signal is left
   * alone. */
  setAll(map: Record<string, string[]>): void;
  /** The per-field messages, get-or-created on first read. `[]` when the
   * field has no error (never touched, or cleared by a later `setAll`). */
  fieldError(name: string): ReadonlySignal<string[]>;
  /** The whole error set as one derived value; reading it subscribes to
   * every field that currently has an error. */
  all: ReadonlySignal<Record<string, string[]>>;
};

function sameMessages(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameNameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const name of b) if (!setA.has(name)) return false;
  return true;
}

const NO_MESSAGES: string[] = [];

export function createFieldErrorStore(): FieldErrorStore {
  // Names currently carrying at least one message; drives `all`'s inclusion
  // set (and, being a signal, its own reactivity to a field gaining or
  // losing its error entirely).
  const presentNames = signal<readonly string[]>([]);
  const byName = new Map<string, Signal<string[]>>();

  const all = computed<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const name of presentNames.value) {
      const s = byName.get(name);
      if (s) out[name] = s.value;
    }
    return out;
  });

  return {
    setAll(map) {
      const nextNames = Object.keys(map);
      const nextNameSet = new Set(nextNames);

      for (const name of nextNames) {
        const value = map[name]!;
        const existing = byName.get(name);
        if (existing) {
          if (!sameMessages(existing.peek(), value)) existing.value = value;
        } else {
          byName.set(name, signal(value));
        }
      }

      // A field dropped out of the map: clear its signal (touch it only if
      // it wasn't already empty) rather than deleting the Map entry, so a
      // reader that already holds this signal (from an earlier `fieldError`
      // call) is notified, and the same signal object is reused if the
      // field's errors return later.
      for (const [name, s] of byName) {
        if (!nextNameSet.has(name) && s.peek().length > 0) {
          s.value = [];
        }
      }

      if (!sameNameSet(presentNames.peek(), nextNames)) {
        presentNames.value = nextNames;
      }
    },
    fieldError(name) {
      let s = byName.get(name);
      if (!s) {
        s = signal<string[]>(NO_MESSAGES);
        byName.set(name, s);
      }
      return s;
    },
    all,
  };
}
