# Client-side schema pre-validation for `useAction` (#154)

**Status:** approved design, pre-implementation
**Issue:** #154 (follow-up to the PR #153 review, finding [6])
**Scope:** give `useAction` the same opt-in client pre-validation `<Form schema>` has, surfacing a client-rejected payload identically to a server `deny(422)`.

## Problem

Standard Schema client pre-validation is currently `<Form schema>`-only. An app
driving a typed action imperatively via `useAction(stub)` has no client gate:
every invalid payload makes a server round-trip and returns a `deny(422)` the
caller decodes with `getValidationIssues`. This adds an opt-in client gate so the
validation behavior and error surface are consistent regardless of how the stub
is invoked. The server remains authoritative.

## Why a client-supplied schema (not the stub's own)

`defineAction(fn, { input })` declares the action's schema, and the stub carries
`input` (`ActionRef.input`). But `input` lives in the `.server` module and a
Standard Schema's validate function cannot cross the client RPC boundary, so the
client cannot obtain it. The app supplies a client-imported Standard Schema,
exactly as `<Form schema>` does. (Typed to the payload; a mismatched schema is a
type error, not a silent bypass. The server still re-validates.)

## API

Add an optional `schema` to the shared action-options base
(`UseActionOptionsCommon` in `packages/iso/src/action.ts`), threading `TPayload`
into it (the base is currently generic only over `TChunk`, so it must gain
`TPayload`), and pass `TPayload` from both variants:

```ts
type UseActionOptionsCommon<TPayload, TChunk = never> = {
  invalidate?: 'auto' | false | ReadonlyArray<AnyLoaderRef>;
  onChunk?: (chunk: Serialize<TChunk>) => void;
  /**
   * Opt-in client-side Standard Schema pre-validation, the imperative parity of
   * `<Form schema>`. When set, `mutate` validates the payload before the request
   * and, on failure, rejects it locally as the same `deny(422)` the server would
   * produce (no round-trip). Fails open: if the schema's validate throws, the
   * request proceeds and the server validates authoritatively. The client never
   * coerces the sent payload; the server re-validates and coerces.
   */
  schema?: StandardSchemaV1<unknown, TPayload>;
};

type UseActionWithMutate<TPayload, TResult, TChunk, TSnapshot> =
  UseActionOptionsCommon<TPayload, TChunk> & {
    onMutate: (payload: TPayload) => TSnapshot;
    onError?: (err: Error, snapshot: TSnapshot) => void;
    onSuccess?: (data: Serialize<TResult>, snapshot: TSnapshot) => void;
  };

// gains TPayload (was `<TResult, TChunk>`) so it can carry schema<TPayload>
type UseActionWithoutMutate<TPayload, TResult, TChunk> =
  UseActionOptionsCommon<TPayload, TChunk> & {
    onMutate?: undefined;
    onError?: (err: Error) => void;
    onSuccess?: (data: Serialize<TResult>) => void;
  };

export type UseActionOptions<TPayload, TResult, TChunk = never, TSnapshot = unknown> =
  | UseActionWithMutate<TPayload, TResult, TChunk, TSnapshot>
  | UseActionWithoutMutate<TPayload, TResult, TChunk>;
```

The public `UseActionOptions<TPayload, ...>` generic order is unchanged, so no
call site or export breaks; only the private base and the without-mutate variant
gain the `TPayload` parameter.

## Mechanism (in `useAction`'s `mutate`)

The gate runs at the very top of the `mutate` callback, **before** any side
effect (`onMutate`, `setPending(true)`, the `AbortController`, `beginSubmit`, the
fetch), so a payload rejected client-side never begins the mutation lifecycle:

```ts
const stub = stubRef.current;
const schema = optionsRef.current?.schema;
if (schema) {
  let validated: ValidationResult<TPayload> | undefined;
  try {
    validated = await validateWithSchema(schema, payload);
  } catch (err) {
    // Fail open: the schema's validate threw/rejected; let the server validate.
    logClientSchemaThrew(err);
  }
  if (validated && !validated.ok) {
    const error = new Error('Validation failed');
    recordOutcome(stub.__module, stub.__action, {
      kind: 'deny',
      status: 422,
      message: 'Validation failed',
      data: { [VALIDATION_ISSUES_KEY]: validated.issues },
      submittedPayload: payload,
    });
    setError(error);
    return { ok: false, error };
  }
}
// ... existing mutate body (onMutate, beginSubmit, fetch) unchanged ...
```

The recorded outcome is byte-identical to the server's `coerceActionInput`
failure: `deny(422, 'Validation failed', { data: { [VALIDATION_ISSUES_KEY]:
issues } })` (`internal/loader-schema.ts`). So the caller decodes it the same way
whether the client or the server rejected it:

```ts
const result = useActionResult(create);
const issues = getValidationIssues(result); // works identically
```

### Consequences (explicit)

- **No `onMutate`, no optimistic, no `onError`** on a client validation failure:
  the mutation lifecycle never begins, so there is no snapshot to thread and no
  optimistic state to revert (matching `<Form schema>`, which validates before
  `addOptimistic`). The caller learns of the failure from the returned
  `{ ok: false, error }`, the hook's `error` state, and
  `getValidationIssues(useActionResult(stub))`. `onError` firing would need an
  `onMutate` snapshot that never ran, so it is deliberately not called here.
- **`pending` never flips true** for a client-rejected payload (the gate returns
  before `setPending(true)`).
- **`error` state is set** to `Error('Validation failed')`, matching the hook
  state after a server `deny(422)`.
- **Gate only, no coercion of the sent payload.** On pass, the original payload
  is sent unchanged; the server re-validates and coerces authoritatively (the
  client validation is a pass/fail gate, like `<Form>`). The validated output is
  not sent.

## Small shared-helper extraction (DRY)

`logClientSchemaThrew` currently lives privately in `form.tsx`. Extract it to
`validate.ts` (or a tiny sibling) and import it in both `form.tsx` and
`action.ts`, so the fail-open log message stays identical across the two
consumption paths and cannot drift. No behavior change to `<Form>`.

## Testing

Unit (`packages/iso/src/__tests__`, driving `useAction` under
`@testing-library/preact`, mocking `fetch`):

- **Invalid payload, schema set:** `fetch` is NOT called; `mutate` resolves
  `{ ok: false, error }` with `error.message === 'Validation failed'`;
  `getValidationIssues(useActionResult(stub))` returns the schema's issues;
  `pending` never became true; `onMutate`/`onError` were not called.
- **Valid payload, schema set:** `fetch` IS called with the original payload
  (not the coerced value); normal success path.
- **Schema throws (fail open):** `fetch` IS called (the request proceeds); the
  fail-open log fires once.
- **No schema:** unchanged behavior (regression guard).
- Type-level (`*.test-d.ts`): `schema` is optional on `UseActionOptions` and
  typed `StandardSchemaV1<unknown, TPayload>`; passing a schema whose output
  mismatches the payload is a type error.

Every assertion that a client rejection matches a server `deny(422)` is
mutation-checked (break the recorded status/message/key, confirm the test
fails).

## Docs

Extend the actions / form-validation docs page to show `useAction(stub, {
schema })` beside `<Form schema>`, noting the shared decode via
`getValidationIssues` and the fail-open + server-authoritative semantics. `schema`
is a new option field (not a new runtime export), so it does not trip the #177
`exports-coverage` gate; no new export to document there.
