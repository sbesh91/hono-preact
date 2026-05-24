import type { JSX, ComponentChildren } from 'preact';
import { useState, useCallback, useMemo } from 'preact/hooks';
import type { ActionStub } from './action.js';
import { OPTIMISTIC_BRAND } from './optimistic-action.js';
import { beginSubmit, endSubmit } from './internal/form-submit-store.js';
import { setLastActionResult } from './internal/action-result-store.js';

export type FormProps<TPayload, TResult> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'action' | 'method' | 'onSubmit' | 'enctype'
> & {
  action: ActionStub<TPayload, TResult, never>;
  children?: ComponentChildren;
};

function collectFormData(
  fd: FormData
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const out: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const [key, value] of fd.entries()) {
    if (key === '__module' || key === '__action') continue;
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

export function Form<TPayload, TResult>({
  action,
  children,
  ...rest
}: FormProps<TPayload, TResult>) {
  const [pending, setPending] = useState(false);
  const moduleKey = action.__module;
  const actionName = action.__action;

  const optimistic = useMemo(
    () =>
      (action as unknown as Record<symbol, unknown>)[OPTIMISTIC_BRAND] as
        | {
            addOptimistic: (payload: TPayload) => {
              settle(): void;
              revert(): void;
            };
          }
        | undefined,
    [action]
  );

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      const formEl = e.currentTarget as HTMLFormElement;
      const target =
        typeof window !== 'undefined'
          ? window.location.pathname + window.location.search
          : '/';
      const fd = new FormData(formEl);
      const payload = collectFormData(fd) as TPayload;
      let handle: { settle(): void; revert(): void } | undefined;
      if (optimistic) handle = optimistic.addOptimistic(payload);

      setPending(true);
      beginSubmit(moduleKey, actionName);
      try {
        const res = await fetch(target, {
          method: 'POST',
          body: fd,
          headers: { Accept: 'application/json' },
        });
        const env = (await res.json().catch(() => null)) as
          | {
              __outcome?: string;
              to?: string;
              message?: string;
              data?: unknown;
              status?: number;
            }
          | null;
        if (!env) {
          handle?.revert();
          if (typeof window !== 'undefined') window.location.reload();
          return;
        }
        if (env.__outcome === 'redirect' && typeof env.to === 'string') {
          if (typeof window !== 'undefined') window.location.assign(env.to);
          handle?.settle();
          return;
        }
        if (env.__outcome === 'success') {
          handle?.settle();
          setLastActionResult(moduleKey, actionName, {
            kind: 'success',
            data: env.data,
            submittedPayload: payload,
          });
          return;
        }
        if (env.__outcome === 'deny') {
          handle?.revert();
          setLastActionResult(moduleKey, actionName, {
            kind: 'deny',
            status: env.status ?? res.status,
            message:
              env.message ?? `Request denied (${env.status ?? res.status})`,
            data: env.data,
            submittedPayload: payload,
          });
          return;
        }
        if (env.__outcome === 'error') {
          handle?.revert();
          setLastActionResult(moduleKey, actionName, {
            kind: 'error',
            message: env.message ?? 'Action failed',
            submittedPayload: payload,
          });
          return;
        }
        // Unknown outcome (e.g. 'timeout'): treat as error.
        handle?.revert();
        setLastActionResult(moduleKey, actionName, {
          kind: 'error',
          message:
            env.message ??
            `Unexpected outcome: ${env.__outcome ?? 'unknown'}`,
          submittedPayload: payload,
        });
      } catch (err) {
        handle?.revert();
        setLastActionResult(moduleKey, actionName, {
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          submittedPayload: payload,
        });
      } finally {
        setPending(false);
        endSubmit(moduleKey, actionName);
      }
    },
    [moduleKey, actionName, optimistic]
  );

  return (
    <form
      {...rest}
      method="post"
      enctype="multipart/form-data"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="__module" value={moduleKey} />
      <input type="hidden" name="__action" value={actionName} />
      <fieldset disabled={pending} class="hp-form-fieldset">
        {children}
      </fieldset>
    </form>
  );
}
