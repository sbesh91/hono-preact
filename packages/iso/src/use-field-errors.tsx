import { useContext } from 'preact/hooks';
import {
  FieldErrorsContext,
  type FieldErrorsMap,
} from './internal/field-errors-context.js';

/**
 * Read the enclosing `<Form>`'s merged field errors (client pre-validation plus
 * any server `deny(422)` issues), keyed by field name (the issue path joined by
 * `.`). Returns `{}` outside a `<Form>`.
 */
export function useFieldErrors(): FieldErrorsMap {
  return useContext(FieldErrorsContext);
}

/**
 * Render the first error message for `name`, or nothing. A thin convenience
 * wrapper over `useFieldErrors`; use the hook directly for custom rendering.
 *
 * Pass `name=""` to render form-level errors (issues whose schema path is
 * empty map to the `""` key).
 */
export function FieldError({
  name,
  class: className,
}: {
  name: string;
  class?: string;
}) {
  const errors = useFieldErrors();
  const message = errors[name]?.[0];
  if (!message) return null;
  return (
    <span class={className} data-field-error={name} role="alert">
      {message}
    </span>
  );
}
