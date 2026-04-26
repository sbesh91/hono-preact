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
    const payload = Object.fromEntries(formData.entries()) as TPayload;
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
