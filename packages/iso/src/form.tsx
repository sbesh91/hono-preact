import type { JSX, ComponentChildren } from 'preact';

export type FormProps<TPayload extends Record<string, unknown>> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'onSubmit'
> & {
  mutate: (payload: TPayload) => Promise<unknown> | unknown;
  pending?: boolean;
  children?: ComponentChildren;
};

/**
 * Collect a FormData into a plain payload object.
 *
 * Repeated field names (checkboxes sharing a name, multi-select, multiple
 * `<input type="file" multiple>` entries) collect into an array. The old
 * `Object.fromEntries(fd)` produced the LAST value only, which was silent
 * data loss: a four-checkbox group would submit one value with no warning.
 *
 * Single-value fields stay scalar. Files survive as `File` instances.
 *
 * Consumers should type their `defineAction<TPayload, ...>` to match:
 * `tags: string[]`, `photos: File[]`, etc. for fields that may have multiple
 * values; scalar types for fields that won't.
 */
function collectFormData(
  fd: FormData
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const payload: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const [key, value] of fd.entries()) {
    if (key in payload) {
      const existing = payload[key];
      payload[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

export function Form<TPayload extends Record<string, unknown>>({
  mutate,
  pending,
  children,
  ...rest
}: FormProps<TPayload>) {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const formEl = e.currentTarget as HTMLFormElement;
    const formData = new FormData(formEl);
    const payload = collectFormData(formData) as TPayload;
    void mutate(payload);
  };

  return (
    <form {...rest} onSubmit={handleSubmit}>
      <fieldset disabled={pending} class="hp-form-fieldset">
        {children}
      </fieldset>
    </form>
  );
}
