import { signal, computed, batch } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';

/**
 * Field name (dot-joined issue path) -> messages for that field.
 *
 * The messages are `readonly`: they are handed straight out to userland by
 * `useFieldErrors`, and they are the very arrays the store's per-field signals
 * hold, so a caller mutating one would silently rewrite store state behind the
 * signal's back (no write, hence no notification, hence a stale render).
 */
export type FieldErrorsMap = Record<string, readonly string[]>;

/**
 * A per-field granular error store: `fieldError(name)` is a per-field signal,
 * so a `<FieldError name="x">` re-renders only when field `x`'s own errors
 * change, mirroring `roster-signal.ts`'s `member(id)` / `members` split.
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
  setAll(map: FieldErrorsMap): void;
  /** The per-field messages, get-or-created on first read. `[]` when the
   * field has no error (never touched, or cleared by a later `setAll`). */
  fieldError(name: string): ReadonlySignal<readonly string[]>;
  /** The whole error set as one derived value; reading it subscribes to
   * every field that currently has an error. */
  all: ReadonlySignal<FieldErrorsMap>;
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

export function createFieldErrorStore(): FieldErrorStore {
  // Names currently carrying at least one message; drives `all`'s inclusion
  // set (and, being a signal, its own reactivity to a field gaining or
  // losing its error entirely).
  const presentNames = signal<readonly string[]>([]);
  const byName = new Map<string, Signal<readonly string[]>>();

  const all = computed<FieldErrorsMap>(() => {
    const out: Record<string, readonly string[]> = {};
    for (const name of presentNames.value) {
      const s = byName.get(name);
      if (s) out[name] = s.value;
    }
    return out;
  });

  return {
    setAll(map) {
      // Only fields that actually carry an error are "present": an empty array
      // is treated as absent, so `all` means "every field that currently has an
      // error" (a field passed as `{ a: [] }` is cleared by the drop loop below,
      // not surfaced in `all`).
      const nextNames = Object.keys(map).filter(
        (name) => map[name]!.length > 0
      );
      const nextNameSet = new Set(nextNames);

      // One batch for up to N+1 writes. `<Form>` calls `setAll` during its
      // render, and a bare write flushes its subscribers synchronously, so
      // without this a form with N changed fields would run N separate
      // notification passes mid-render instead of one.
      batch(() => {
        for (const name of nextNames) {
          const value = map[name]!;
          const existing = byName.get(name);
          if (existing) {
            if (!sameMessages(existing.peek(), value)) existing.value = value;
          } else {
            byName.set(name, signal<readonly string[]>(value));
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
      });
    },
    fieldError(name) {
      let s = byName.get(name);
      if (!s) {
        // A FRESH empty array per field, never one shared module-level
        // constant: the array is handed out to userland, and one shared
        // instance would make every never-errored field's messages the same
        // object.
        s = signal<readonly string[]>([]);
        byName.set(name, s);
      }
      return s;
    },
    all,
  };
}

/**
 * The store a consumer gets OUTSIDE a `<Form>`: no fields, no errors, ever.
 *
 * Deliberately not a `createFieldErrorStore()`. That store's `fieldError(name)`
 * get-or-creates a signal on read and keeps it in a closed-over Map, which is
 * right when a field's errors may arrive later -- and wrong here, because
 * nothing ever writes to this one. As the context DEFAULT it also lives at
 * module scope, shared by every SSR request in a long-lived worker isolate, so
 * reading it was an unbounded leak for any page whose field names come from the
 * request (`items.0.email`, `items.1.email`, ...). See #349 R10.
 *
 * Since no field can ever differ from any other, one shared signal serves them
 * all and a read allocates nothing. The array it carries is FROZEN: sharing it
 * is what makes the store free, and freezing is what keeps that safe, since a
 * caller mutating one field's messages would otherwise be mutating every
 * field's. `createFieldErrorStore` allocates per field and needs no such guard.
 */
const NO_MESSAGES: readonly string[] = Object.freeze([]);
const NO_MESSAGES_SIGNAL = signal<readonly string[]>(NO_MESSAGES);
const NO_FIELDS: FieldErrorsMap = Object.freeze({});
const NO_FIELDS_SIGNAL = signal<FieldErrorsMap>(NO_FIELDS);

export const INERT_FIELD_ERROR_STORE: FieldErrorStore = {
  // A `<Form>` writes to its OWN store; nothing routes writes here. Accepting
  // and ignoring the call keeps the type honest without pretending to store.
  setAll() {},
  fieldError: () => NO_MESSAGES_SIGNAL,
  all: NO_FIELDS_SIGNAL,
};
