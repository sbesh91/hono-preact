import type { JSX, ComponentChildren } from 'preact';
import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useId,
} from 'preact/hooks';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ActionRef } from './action.js';
import {
  OPTIMISTIC_BRAND,
  type UseOptimisticActionResult,
} from './optimistic-action.js';
import type { OptimisticHandle } from './optimistic.js';
import { beginSubmit, endSubmit } from './internal/form-submit-store.js';
import { FORM_MODULE_FIELD, FORM_ACTION_FIELD } from './internal/contract.js';
import { toError } from './internal/to-error.js';
import { collectFormData } from './internal/form-data.js';
import {
  setLastActionResult,
  getLastActionResult,
} from './internal/action-result-store.js';
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
  FieldErrorPrefixContext,
  type FieldErrorsMap,
} from './internal/field-errors-context.js';

function logClientSchemaThrew(err: unknown): void {
  console.error(
    'hono-preact: client schema validation threw; proceeding to server-side validation.',
    err
  );
}

/**
 * The `action` prop accepts either a plain action stub or the branded value
 * returned by `useOptimisticAction`. The union lets `<Form>` discover the
 * optimistic apply via `OPTIMISTIC_BRAND in action` narrowing without
 * casting away the type.
 */
type FormActionInput<TPayload, TResult> =
  | ActionRef<TPayload, TResult, never>
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

export function Form<TPayload, TResult>({
  action,
  children,
  onSuccess,
  onError,
  invalidate,
  reset,
  schema,
  onInput: consumerOnInput,
  ...rest
}: FormProps<TPayload, TResult>) {
  const [pending, setPending] = useState(false);
  const [clientErrors, setClientErrors] = useState<FieldErrorsMap>({});
  // A stable per-Form prefix so `<FieldError>` ids are unique across forms and
  // `useFieldErrorProps` can wire `aria-describedby` to them.
  const fieldErrorPrefix = useId();
  const [clearedServerFields, setClearedServerFields] = useState<Set<string>>(
    () => new Set()
  );
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  // hasSubmittedRef: true once the user has attempted the first submit.
  // Before that, handleInput stays quiet (validating mode not yet active).
  const hasSubmittedRef = useRef(false);
  // Debounce timer ref for live revalidation.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sequence guard so a stale async revalidation cannot overwrite a newer one.
  const inputSeq = useRef(0);

  // Clear the debounce timer on unmount so a pending revalidation cannot call
  // setClientErrors after the component has been torn down.
  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    },
    []
  );

  const moduleKey = action.__module;
  const actionName = action.__action;
  const applyInvalidate = useInvalidate();
  const lifecycle = useRef({ onSuccess, onError, invalidate, reset });
  lifecycle.current = { onSuccess, onError, invalidate, reset };

  const optimistic = useMemo(
    () => (hasOptimisticBrand(action) ? action[OPTIMISTIC_BRAND] : undefined),
    [action]
  );

  // When the server returns a fresh response it is authoritative: reset the
  // suppression set so server errors are displayed again.
  //
  // We compare the raw store entry reference (from getLastActionResult, which
  // returns the same Map value object across renders until a new result is
  // stored) rather than a derived result object (which would be recreated on
  // every render) or submittedPayload (which can be a new object reference even
  // when the underlying data has not changed in some runtimes).
  //
  // Derived-state-during-render: if the store entry changed, reset
  // clearedServerFields synchronously before the current render paints.
  // This avoids a useEffect round-trip that can cause a flicker where
  // the cleared set is reset AFTER the child tree sees it.
  const storeEntry = getLastActionResult(action);
  const prevStoreEntryRef = useRef<
    ReturnType<typeof getLastActionResult> | undefined
  >(undefined);
  if (prevStoreEntryRef.current !== storeEntry) {
    prevStoreEntryRef.current = storeEntry;
    if (clearedServerFields.size > 0) {
      // A new server result arrived; discard any optimistic suppressions.
      // setClearedServerFields during render is the React/Preact-approved
      // derived-state pattern (analogous to getDerivedStateFromProps): it
      // schedules a synchronous re-render with the new state before painting.
      setClearedServerFields(new Set());
    }
  }

  // Split into two memos: server errors only recompute when the server result
  // changes; fieldErrors recomputes on keystroke (when clientErrors updates).
  //
  // useActionResult reads both the browser-global action-result store (via
  // useSyncExternalStore, restoring the subscription) AND the request-scoped
  // ActionResultContext (the SSR / no-JS deny re-render path). Keying the memo
  // on the deny result's underlying data object keeps it stable across unrelated
  // re-renders: useActionResult re-wraps into a new object each render, but for
  // a deny its .data points at the same stable store/context object until a
  // fresh result arrives. For non-deny results the key is null (no issues).
  const serverResult = useActionResult(
    action as ActionRef<TPayload, TResult, never>
  );
  const serverErrors = useMemo<FieldErrorsMap>(
    () => mapIssuesToFields(getValidationIssues(serverResult)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverResult?.kind === 'deny' ? serverResult.data : null]
  );

  // Merge: server errors minus optimistically-cleared fields, then client
  // errors override (live revalidation is always the freshest signal).
  const fieldErrors = useMemo<FieldErrorsMap>(() => {
    const out: FieldErrorsMap = {};
    for (const k of Object.keys(serverErrors)) {
      if (!clearedServerFields.has(k)) out[k] = serverErrors[k]!;
    }
    return { ...out, ...clientErrors };
  }, [serverErrors, clientErrors, clearedServerFields]);

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      // Validating mode begins at first submit.
      hasSubmittedRef.current = true;
      // Invalidate any in-flight debounced revalidation. A debounce whose timer
      // has already fired but whose async validate has not resolved yet will see
      // its captured seq become stale and bail without calling setClientErrors,
      // so the submit's own state writes always win.
      inputSeq.current += 1;
      // Cancel any pending debounced revalidation.
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

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
        try {
          const result = await validateWithSchema(schemaRef.current, payload);
          if (!result.ok) {
            setClientErrors(mapIssuesToFields(result.issues));
            return; // block the POST; server never sees an invalid payload
          }
          // Valid: clear any prior client errors and fall through to POST.
          setClientErrors({});
        } catch (err) {
          // The schema's validate function threw or rejected. Fail open: let the
          // server validate authoritatively rather than dead-ending the form.
          logClientSchemaThrew(err);
          // Fall through to POST below.
        }
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
        lifecycle.current.onError?.(toError(err));
      } finally {
        setPending(false);
        endSubmit(moduleKey, actionName);
      }
    },
    [moduleKey, actionName, optimistic, applyInvalidate]
  );

  const handleInput = useCallback((e: Event) => {
    // Quiet before first submit; validating mode is not yet active.
    if (!hasSubmittedRef.current) return;
    // Schema-less forms get no live client revalidation; their server errors
    // clear on the next submit.
    if (!schemaRef.current) return;

    const name = (e.target as { name?: string } | null)?.name;
    if (!name) return;

    // Optimistically suppress the server error for this field while the user
    // is editing it; it re-surfaces on the next submit if still server-invalid.
    setClearedServerFields((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });

    // Cancel any in-flight debounce timer.
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }

    // Capture the form element synchronously before the timer fires; the
    // synthetic event object will be gone by the time the callback runs.
    const formEl = e.currentTarget as HTMLFormElement;
    const schema = schemaRef.current;

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      const seq = (inputSeq.current += 1);
      const record = collectFormData(new FormData(formEl));
      void validateWithSchema(schema, record)
        .then((result) => {
          if (seq !== inputSeq.current) return; // superseded by a newer keystroke
          setClientErrors(result.ok ? {} : mapIssuesToFields(result.issues));
        })
        .catch((err) => {
          // The schema threw or rejected during live revalidation. Log and bail;
          // do not update clientErrors so the user can keep typing.
          logClientSchemaThrew(err);
        });
    }, 150);
  }, []);

  // Compose consumer's onInput with the framework's live-clear handler so both
  // run on every input event. Consumer fires first. useCallback stabilizes the
  // reference so the <form> does not reattach the listener on every render.
  const composedOnInput: JSX.InputEventHandler<HTMLFormElement> = useCallback(
    consumerOnInput
      ? (e) => {
          consumerOnInput(e);
          handleInput(e);
        }
      : (e) => handleInput(e),
    [consumerOnInput, handleInput]
  );

  return (
    <form
      {...rest}
      method="post"
      enctype="multipart/form-data"
      onSubmit={handleSubmit}
      onInput={composedOnInput}
    >
      <input type="hidden" name={FORM_MODULE_FIELD} value={moduleKey} />
      <input type="hidden" name={FORM_ACTION_FIELD} value={actionName} />
      <FieldErrorPrefixContext.Provider value={fieldErrorPrefix}>
        <FieldErrorsContext.Provider value={fieldErrors}>
          <fieldset disabled={pending} class="hp-form-fieldset">
            {children}
          </fieldset>
        </FieldErrorsContext.Provider>
      </FieldErrorPrefixContext.Provider>
    </form>
  );
}
