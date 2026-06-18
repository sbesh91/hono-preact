import type { JSX, ComponentChildren } from 'preact';
import { useState, useCallback, useMemo, useRef } from 'preact/hooks';
import type { ActionStub } from './action.js';
import {
  OPTIMISTIC_BRAND,
  type UseOptimisticActionResult,
} from './optimistic-action.js';
import type { OptimisticHandle } from './optimistic.js';
import { beginSubmit, endSubmit } from './internal/form-submit-store.js';
import { FORM_MODULE_FIELD, FORM_ACTION_FIELD } from './internal/contract.js';
import { setLastActionResult } from './internal/action-result-store.js';
import { assignSafeRedirect } from './internal/safe-redirect.js';
import { decodeActionResponse } from './internal/action-envelope.js';
import type { AnyLoaderRef } from './define-loader.js';
import type { Serialize } from './internal/serialize.js';
import { useInvalidate } from './use-invalidate.js';

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
  onSuccess?: (
    data: Serialize<TResult>,
    helpers: { reset: (fields?: string[]) => void }
  ) => void;
  onError?: (err: Error) => void;
  invalidate?: 'auto' | false | ReadonlyArray<AnyLoaderRef>;
  reset?: boolean;
};

function resetFormFields(formEl: HTMLFormElement, fields?: string[]): void {
  if (!fields) {
    formEl.reset();
    return;
  }
  for (const name of fields) {
    const el = formEl.elements.namedItem(name);
    const nodes = el instanceof RadioNodeList ? Array.from(el) : el ? [el] : [];
    for (const node of nodes) {
      if (node instanceof HTMLInputElement) {
        if (node.type === 'checkbox' || node.type === 'radio')
          node.checked = node.defaultChecked;
        else node.value = node.defaultValue;
      } else if (node instanceof HTMLTextAreaElement) {
        node.value = node.defaultValue;
      } else if (node instanceof HTMLSelectElement) {
        for (const opt of Array.from(node.options))
          opt.selected = opt.defaultSelected;
      }
    }
  }
}

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

export function Form<TPayload, TResult>({
  action,
  children,
  onSuccess,
  onError,
  invalidate,
  reset,
  ...rest
}: FormProps<TPayload, TResult>) {
  const [pending, setPending] = useState(false);
  const moduleKey = action.__module;
  const actionName = action.__action;
  const applyInvalidate = useInvalidate();
  const lifecycle = useRef({ onSuccess, onError, invalidate, reset });
  lifecycle.current = { onSuccess, onError, invalidate, reset };

  const optimistic = useMemo(
    () => (hasOptimisticBrand(action) ? action[OPTIMISTIC_BRAND] : undefined),
    [action]
  );

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      const formEl = e.currentTarget as HTMLFormElement;
      const resetForm = (fields?: string[]) => resetFormFields(formEl, fields);
      const target =
        typeof window !== 'undefined'
          ? window.location.pathname + window.location.search
          : '/';
      const fd = new FormData(formEl);
      // Source the action identity from props, not the DOM hidden inputs. On an
      // initial SSR page those inputs render empty (server-side defineAction
      // carries no name metadata) and Preact's hydrate() does not patch their
      // values, so reading them back would post __module/__action='' and 404.
      fd.set(FORM_MODULE_FIELD, moduleKey);
      fd.set(FORM_ACTION_FIELD, actionName);
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
              message: `Refused cross-origin redirect to ${decoded.to}. redirect() must target a same-origin path (e.g. "/dashboard"), not an absolute URL to another origin.`,
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
            lifecycle.current.onSuccess?.(decoded.data as Serialize<TResult>, {
              reset: resetForm,
            });
            applyInvalidate(lifecycle.current.invalidate);
            if (lifecycle.current.reset) resetForm();
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
            lifecycle.current.onError?.(new Error(decoded.message));
            return;
          case 'timeout':
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message: `Request timed out after ${decoded.timeoutMs}ms`,
              submittedPayload: payload,
            });
            lifecycle.current.onError?.(
              new Error(`Request timed out after ${decoded.timeoutMs}ms`)
            );
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
            lifecycle.current.onError?.(
              new Error(
                decoded.message ??
                  `Unexpected outcome: ${decoded.outcome ?? 'unknown'}`
              )
            );
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
        lifecycle.current.onError?.(
          err instanceof Error ? err : new Error(String(err))
        );
      } finally {
        setPending(false);
        endSubmit(moduleKey, actionName);
      }
    },
    [moduleKey, actionName, optimistic, applyInvalidate]
  );

  return (
    <form
      {...rest}
      method="post"
      enctype="multipart/form-data"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name={FORM_MODULE_FIELD} value={moduleKey} />
      <input type="hidden" name={FORM_ACTION_FIELD} value={actionName} />
      <fieldset disabled={pending} class="hp-form-fieldset">
        {children}
      </fieldset>
    </form>
  );
}
