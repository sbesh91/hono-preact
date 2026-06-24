import { FORM_MODULE_FIELD, FORM_ACTION_FIELD } from './contract.js';

/**
 * Converts a FormData instance into a plain record, coalescing repeated keys
 * into arrays and skipping the internal framework fields (__module, __action).
 * Used on both the client (Form handleSubmit/handleInput) and the server
 * (pageActionsHandler parseBody) so client and server schema validation always
 * operate on the same payload shape.
 */
export function collectFormData(
  fd: FormData
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const out: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const [key, value] of fd.entries()) {
    if (key === FORM_MODULE_FIELD || key === FORM_ACTION_FIELD) continue;
    const existing = out[key];
    out[key] =
      existing === undefined
        ? value
        : Array.isArray(existing)
          ? [...existing, value]
          : [existing, value];
  }
  return out;
}
