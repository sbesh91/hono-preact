import { useRef, useContext } from 'preact/hooks';
import type { JSX, ComponentChildren } from 'preact';
import { ReloadContext } from './page.js';
import type { ActionStub, UseActionOptions } from './action.js';

type FormProps<TPayload extends Record<string, unknown>, TResult> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'action' | 'onSubmit'
> & UseActionOptions<TPayload, TResult> & {
  action: ActionStub<TPayload, TResult>;
  children?: ComponentChildren;
};

export function Form<TPayload extends Record<string, unknown>, TResult>({
  action,
  invalidate,
  onMutate,
  onError,
  onSuccess,
  children,
  ...rest
}: FormProps<TPayload, TResult>) {
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  const reloadCtx = useContext(ReloadContext);

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const formEl = e.target as HTMLFormElement;
    const formData = new FormData(formEl);
    const payload = Object.fromEntries(formData.entries()) as TPayload;

    if (fieldsetRef.current) {
      fieldsetRef.current.disabled = true;
    }

    let snapshot: unknown;
    if (onMutate) {
      snapshot = onMutate(payload);
    }

    fetch('/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: (action as unknown as { __module: string }).__module,
        action: (action as unknown as { __action: string }).__action,
        payload,
      }),
    })
      .then(async (response) => {
        if (fieldsetRef.current) {
          fieldsetRef.current.disabled = false;
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            (JSON.parse(text) as { error?: string }).error ??
              `Action failed with status ${response.status}`
          );
        }
        const text = await response.text();
        const result = JSON.parse(text) as TResult;
        onSuccess?.(result);
        if (invalidate === 'auto') {
          reloadCtx?.reload();
        }
      })
      .catch((err) => {
        if (fieldsetRef.current) {
          fieldsetRef.current.disabled = false;
        }
        const e = err instanceof Error ? err : new Error(String(err));
        onError?.(e, snapshot);
      });
  };

  return (
    <form {...rest} onSubmit={handleSubmit}>
      <fieldset ref={fieldsetRef} style={{ border: 'none', padding: 0, margin: 0 }}>
        {children}
      </fieldset>
    </form>
  );
}
