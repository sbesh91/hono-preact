import { createContext } from 'preact';

/** Field name (dot-joined issue path) -> messages for that field. */
export type FieldErrorsMap = Record<string, string[]>;

/**
 * Carries a `<Form>`'s merged field errors (client pre-validation + server
 * `deny(422)` issues) to `useFieldErrors` / `<FieldError>` descendants.
 */
export const FieldErrorsContext = createContext<FieldErrorsMap>({});
