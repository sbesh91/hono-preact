import type { JSX, ComponentChildren } from 'preact';
import { useState, useCallback, useMemo, useRef } from 'preact/hooks';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ActionStub } from './action.js';
import {
  OPTIMISTIC_BRAND,
  type UseOptimisticActionResult,
} from './optimistic-action.js';
import type { OptimisticHandle } from './optimistic.js';
import { beginSubmit, endSubmit } from './internal/form-submit-store.js';
import { FORM_MODULE_FIELD, FORM_ACTION_FIELD } from './internal/contract.js';
import { setLastActionResult } from './internal/action-result-store.js';
import { decodeActionResponse } from './internal/action-envelope.js';
import { applyDecodedOutcome } from './internal/decoded-outcome.js';
import type { AnyLoaderRef } from './define-loader.js';
import type { Serialize } from './internal/serialize.js';
import { useInvalidate } from './use-invalidate.js';
import { validateWithSchema, mapIssuesToFields } from './validate.js';
import { getValidationIssues } from './get-validation-issues.js';
import { useActionResult } from './use-action-result.js';
import {
  FieldErrorsContext,
  type FieldErrorsMap,
} from './internal/field-errors-context.js';

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
  /**
   * Opt-in client-side pre-validation. Pass the SAME Standard Schema the action
   * declares as its `input` (author it in a shared, non-`.server` module so the
   * browser can import it). Typed to the action's payload so a mismatched schema
   * is a compile error. On submit the form runs it and blocks the POST on
   * failure; the server still re-validates authoritatively.
   */
  schema?: StandardSchemaV1<unknown, TPayload>;
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
  schema,
  ...rest
}: FormProps<TPayload, TResult>) {
  const [pending, setPending] = useState(false);
  const [clientErrors, setClientErrors] = useState<FieldErrorsMap>({});
  const clientErrorsRef = useRef(clientErrors);
  clientErrorsRef.current = clientErrors;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const moduleKey = action.__module;
  const actionName = action.__action;
  const applyInvalidate = useInvalidate();
  const lifecycle = useRef({ onSuccess, onError, invalidate, reset });
  lifecycle.current = { onSuccess, onError, invalidate, reset };

  const optimistic = useMemo(
    () => (hasOptimisticBrand(action) ? action[OPTIMISTIC_BRAND] : undefined),
    [action]
  );

  // Server-returned validation issues (deny 422) for this action, if any.
  const plainStub = hasOptimisticBrand(action) ? undefined : action;
  const serverResult = useActionResult(plainStub);
  const fieldErrors = useMemo<FieldErrorsMap>(() => {
    const server = mapIssuesToFields(getValidationIssues(serverResult));
    // Client pre-validation reflects the most recent interaction, so it wins.
    return { ...server, ...clientErrors };
  }, [serverResult, clientErrors]);

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

      if (schemaRef.current) {
        const result = await validateWithSchema(schemaRef.current, payload);
        if (!result.ok) {
          setClientErrors(mapIssuesToFields(result.issues));
          return; // block the POST; server never sees an invalid payload
        }
        // Valid: clear any prior client errors and fall through to POST.
        setClientErrors({});
      }

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
        // Every outcome records a result (or reloads) and returns; `<Form>`
        // never throws a classified outcome (unlike useAction). The shared
        // dispatcher owns the kind switch and redirect attempt; the sink owns
        // the optimistic settle/revert, the result store, and the callbacks.
        applyDecodedOutcome(decoded, {
          success: (data) => {
            handle?.settle();
            setLastActionResult(moduleKey, actionName, {
              kind: 'success',
              data,
              submittedPayload: payload,
            });
            lifecycle.current.onSuccess?.(data as Serialize<TResult>, {
              reset: resetForm,
            });
            applyInvalidate(lifecycle.current.invalidate);
            if (lifecycle.current.reset) resetForm();
          },
          navigated: () => {
            handle?.settle();
          },
          crossOriginRedirect: (message) => {
            // Revert optimistic, surface as an error result so
            // useActionResult sees it.
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message,
              submittedPayload: payload,
            });
          },
          deny: (status, message, data) => {
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'deny',
              status,
              message,
              data,
              submittedPayload: payload,
            });
          },
          error: (message) => {
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message,
              submittedPayload: payload,
            });
            lifecycle.current.onError?.(new Error(message));
          },
          timeout: (_timeoutMs, message) => {
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message,
              submittedPayload: payload,
            });
            lifecycle.current.onError?.(new Error(message));
          },
          unknown: (outcome, message) => {
            handle?.revert();
            const text =
              message ?? `Unexpected outcome: ${outcome ?? 'unknown'}`;
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message: text,
              submittedPayload: payload,
            });
            lifecycle.current.onError?.(new Error(text));
          },
          malformed: () => {
            // PE fallback policy: a non-envelope body means the POST landed
            // somewhere that didn't speak the action protocol; reload so the
            // server-rendered state wins.
            handle?.revert();
            if (typeof window !== 'undefined') window.location.reload();
          },
        });
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

  const handleInput = useCallback(async (e: Event) => {
    const target = e.target as { name?: string } | null;
    const name = target?.name;
    if (!name || !schemaRef.current) return;
    // Only react once a field has shown an error; quiet fields stay quiet.
    if (!clientErrorsRef.current[name]) return;
    const formEl = e.currentTarget as HTMLFormElement; // capture before await
    const record = collectFormData(new FormData(formEl));
    const result = await validateWithSchema(schemaRef.current, record);
    const fresh = result.ok ? {} : mapIssuesToFields(result.issues);
    setClientErrors((prev) => {
      if (!prev[name]) return prev; // field already cleared (e.g. by a submit); don't revive it
      const next = { ...prev };
      if (fresh[name]) next[name] = fresh[name];
      else delete next[name];
      return next;
    });
  }, []);

  return (
    <form
      {...rest}
      method="post"
      enctype="multipart/form-data"
      onSubmit={handleSubmit}
      onInput={handleInput}
    >
      <input type="hidden" name={FORM_MODULE_FIELD} value={moduleKey} />
      <input type="hidden" name={FORM_ACTION_FIELD} value={actionName} />
      <FieldErrorsContext.Provider value={fieldErrors}>
        <fieldset disabled={pending} class="hp-form-fieldset">
          {children}
        </fieldset>
      </FieldErrorsContext.Provider>
    </form>
  );
}
