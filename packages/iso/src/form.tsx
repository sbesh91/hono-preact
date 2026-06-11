import type { JSX, ComponentChildren } from 'preact';
import { useState, useCallback, useMemo } from 'preact/hooks';
import type { ActionStub } from './action.js';
import {
  OPTIMISTIC_BRAND,
  type UseOptimisticActionResult,
} from './optimistic-action.js';
import type { OptimisticHandle } from './optimistic.js';
import { beginSubmit, endSubmit } from './internal/form-submit-store.js';
import { setLastActionResult } from './internal/action-result-store.js';
import { assignSafeRedirect } from './internal/safe-redirect.js';
import { decodeActionResponse } from './internal/action-envelope.js';

/**
 * The `action` prop accepts either a plain action stub or the branded value
 * returned by `useOptimisticAction`. The union lets `<Form>` discover the
 * optimistic apply via `OPTIMISTIC_BRAND in action` narrowing without
 * casting away the type.
 */
type FormActionInput<TPayload, TResult> =
  | ActionStub<TPayload, TResult, never>
  | UseOptimisticActionResult<TPayload, TResult, unknown>;

export type FormProps<TPayload, TResult> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'action' | 'method' | 'onSubmit' | 'enctype'
> & {
  action: FormActionInput<TPayload, TResult>;
  children?: ComponentChildren;
};

function hasOptimisticBrand<TPayload, TResult>(
  action: FormActionInput<TPayload, TResult>
): action is UseOptimisticActionResult<TPayload, TResult, unknown> {
  return OPTIMISTIC_BRAND in action;
}

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
    () => (hasOptimisticBrand(action) ? action[OPTIMISTIC_BRAND] : undefined),
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
      // Source the action identity from props, not the DOM hidden inputs. On an
      // initial SSR page those inputs render empty (server-side defineAction
      // carries no name metadata) and Preact's hydrate() does not patch their
      // values, so reading them back would post __module/__action='' and 404.
      fd.set('__module', moduleKey);
      fd.set('__action', actionName);
      const payload = collectFormData(fd) as TPayload;
      let handle: OptimisticHandle | undefined;
      if (optimistic) handle = optimistic.addOptimistic(payload);

      setPending(true);
      beginSubmit(moduleKey, actionName);
      try {
        const res = await fetch(target, {
          method: 'POST',
          body: fd,
          headers: { Accept: 'application/json' },
        });
        const decoded = await decodeActionResponse(res);
        switch (decoded.kind) {
          case 'malformed':
            // PE fallback policy: a non-envelope body means the POST landed
            // somewhere that didn't speak the action protocol; reload so the
            // server-rendered state wins.
            handle?.revert();
            if (typeof window !== 'undefined') window.location.reload();
            return;
          case 'redirect': {
            const navigated = assignSafeRedirect(decoded.to);
            if (navigated) {
              handle?.settle();
              return;
            }
            // Cross-origin: revert optimistic, surface as error result so
            // useActionResult sees it.
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message: `Refused cross-origin redirect to ${decoded.to}`,
              submittedPayload: payload,
            });
            return;
          }
          case 'success':
            handle?.settle();
            setLastActionResult(moduleKey, actionName, {
              kind: 'success',
              data: decoded.data,
              submittedPayload: payload,
            });
            return;
          case 'deny':
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'deny',
              status: decoded.status,
              message: decoded.message,
              data: decoded.data,
              submittedPayload: payload,
            });
            return;
          case 'error':
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message: decoded.message,
              submittedPayload: payload,
            });
            return;
          case 'timeout':
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message: `Request timed out after ${decoded.timeoutMs}ms`,
              submittedPayload: payload,
            });
            return;
          case 'unknown':
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message:
                decoded.message ??
                `Unexpected outcome: ${decoded.outcome ?? 'unknown'}`,
              submittedPayload: payload,
            });
            return;
          default:
            decoded satisfies never;
        }
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
