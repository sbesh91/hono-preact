import type { JSX, ComponentChildren } from 'preact';

export type FormProps<TPayload extends Record<string, unknown>> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'onSubmit'
> & {
  mutate: (payload: TPayload) => Promise<void> | void;
  pending?: boolean;
  children?: ComponentChildren;
};

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
    const payload = Object.fromEntries(formData.entries()) as Record<string, unknown>;

    // Overlay File inputs directly from the DOM so the original File objects
    // (with their filenames) are preserved in the payload.
    const fileInputs = formEl.querySelectorAll<HTMLInputElement>('input[type="file"]');
    for (const input of fileInputs) {
      if (input.name && input.files && input.files.length > 0) {
        payload[input.name] = input.files[0];
      }
    }

    void mutate(payload as TPayload);
  };

  return (
    <form {...rest} onSubmit={handleSubmit}>
      <fieldset disabled={pending} class="hp-form-fieldset">
        {children}
      </fieldset>
    </form>
  );
}
