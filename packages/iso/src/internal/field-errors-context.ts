import { createContext } from 'preact';

/** Field name (dot-joined issue path) -> messages for that field. */
export type FieldErrorsMap = Record<string, string[]>;

/**
 * Carries a `<Form>`'s merged field errors (client pre-validation + server
 * `deny(422)` issues) to `useFieldErrors` / `<FieldError>` descendants.
 */
export const FieldErrorsContext = createContext<FieldErrorsMap>({});

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
