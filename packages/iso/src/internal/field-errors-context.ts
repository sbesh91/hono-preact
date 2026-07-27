import { createContext } from 'preact';
import { createFieldErrorStore } from './field-error-signal.js';
import type { FieldErrorStore } from './field-error-signal.js';

export type { FieldErrorStore, FieldErrorsMap } from './field-error-signal.js';

/**
 * Carries a `<Form>`'s merged field errors (client pre-validation + server
 * `deny(422)` issues) to `useFieldErrors` / `<FieldError>` descendants, as a
 * per-field signal accessor (`fieldError(name)` / `all`) rather than the raw
 * map: `useFieldErrors(name)` reads `fieldError(name).value`, subscribing
 * only to that field, so a sibling field's error change does not re-render
 * this consumer. `useFieldErrors()` (no name) reads `all.value`, the whole
 * map, and subscribes to every field.
 *
 * The default (outside a `<Form>`) is an inert store that nothing ever
 * writes to, so `fieldError(name).value` is always `[]` and `all.value` is
 * always `{}`.
 */
export const FieldErrorsContext = createContext<FieldErrorStore>(
  createFieldErrorStore()
);

/**
 * A per-`<Form>` unique id prefix (a `useId()`), used to mint stable, collision-
 * free ids for `<FieldError>` elements so an input can reference its error via
 * `aria-describedby`. Empty outside a `<Form>` (no association is possible
 * there, and a stray `<FieldError>` renders nothing without errors anyway).
 */
export const FieldErrorPrefixContext = createContext<string>('');

/**
 * The DOM id for a field's error element, shared by `<FieldError>` (which sets
 * it) and `useFieldErrorProps` (which references it via `aria-describedby`).
 * Field names are dot-joined issue paths, which are valid in an HTML id.
 */
export function fieldErrorId(prefix: string, name: string): string {
  return `${prefix}-field-error-${name}`;
}
