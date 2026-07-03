# useAction client pre-validation (#154) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `useAction` an opt-in `schema` for client-side Standard Schema pre-validation, rejecting an invalid payload locally as the byte-identical `deny(422)` a server validation failure produces.

**Architecture:** Add a `schema` field to `useAction`'s options (threading `TPayload` through the private options types), and a gate at the top of `mutate` that validates before any side effect. On failure it records the same `{ kind: 'deny', status: 422, message: 'Validation failed', data: { [VALIDATION_ISSUES_KEY]: issues } }` outcome the server's `coerceActionInput` produces, so `getValidationIssues(useActionResult(stub))` decodes both identically. Fails open, gate-only.

**Tech Stack:** Preact, TypeScript, `@standard-schema/spec`, Vitest (happy-dom), `@testing-library/preact`.

## Global Constraints

- No em-dashes in prose, comments, or commit messages (commas/semicolons/parentheses instead).
- Casts are smells: reshape types rather than `as`.
- The server remains authoritative: client validation is a pass/fail gate that never coerces or replaces the sent payload; on pass the original payload is sent and the server re-validates.
- Fail open: if the schema's validate throws or rejects, the request proceeds to the server.
- A client validation failure is byte-identical to the server's: `deny(422, 'Validation failed', { data: { [VALIDATION_ISSUES_KEY]: issues } })` (see `internal/loader-schema.ts` `coerceActionInput`).
- No `onMutate` / optimistic / `onError` runs on a client validation failure (the mutation lifecycle never begins); `pending` never flips true; the hook `error` state is set.
- Public `UseActionOptions<TPayload, ...>` generic order is unchanged (only private types gain `TPayload`).
- Pre-push, run the 8 CI-parity checks from `CLAUDE.md`.

---

## File structure

- `packages/iso/src/validate.ts` — gains an exported `logClientSchemaThrew` (moved from `form.tsx`) so both consumers share the fail-open log. (Task 1.)
- `packages/iso/src/form.tsx` — imports `logClientSchemaThrew` instead of defining it. (Task 1.)
- `packages/iso/src/action.ts` — `schema` option (type threading) + the `mutate` gate. (Task 2.)
- Tests: `packages/iso/src/__tests__/action.test.tsx` (add cases), `packages/iso/src/__tests__/use-action-schema.test-d.ts` (create). (Task 2.)
- Docs: the actions / form-validation docs page. (Task 3.)

---

## Task 1: Share `logClientSchemaThrew` (DRY prerequisite)

**Files:**
- Modify: `packages/iso/src/validate.ts` (add the exported helper)
- Modify: `packages/iso/src/form.tsx` (remove the local definition at ~line 39; import it)

**Interfaces:**
- Produces: `export function logClientSchemaThrew(err: unknown): void` from `packages/iso/src/validate.js` (the fail-open log used when a client schema's validate throws).

- [ ] **Step 1: Add the helper to `validate.ts`**

Append to `packages/iso/src/validate.ts`:

```ts
/**
 * Fail-open log for when a client-side schema's validate throws or rejects: the
 * request proceeds to server-side validation rather than dead-ending. Shared by
 * `<Form schema>` and `useAction({ schema })` so the message cannot drift.
 */
export function logClientSchemaThrew(err: unknown): void {
  console.error(
    'hono-preact: client schema validation threw; proceeding to server-side validation.',
    err
  );
}
```

- [ ] **Step 2: Import it in `form.tsx`, remove the local copy**

In `packages/iso/src/form.tsx`, delete the local `function logClientSchemaThrew(err: unknown) { ... }` (at ~line 39). Add `logClientSchemaThrew` to the existing import from `./validate.js` (currently `import { validateWithSchema, mapIssuesToFields } from './validate.js';`):

```ts
import {
  validateWithSchema,
  mapIssuesToFields,
  logClientSchemaThrew,
} from './validate.js';
```

- [ ] **Step 3: Verify no behavior change**

Run: `pnpm vitest run packages/iso/src/__tests__/form.test.tsx`
Expected: PASS (the `<Form>` fail-open behavior is unchanged; only the function's home moved).

- [ ] **Step 4: Typecheck the moved symbol**

Run: `pnpm --filter @hono-preact/iso exec tsc --noEmit`
Expected: clean (no unresolved import).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/validate.ts packages/iso/src/form.tsx
git commit -m "refactor(#154): share logClientSchemaThrew from validate.ts"
```

---

## Task 2: `schema` option + `mutate` pre-validation gate

**Files:**
- Modify: `packages/iso/src/action.ts` (imports; the options types at ~lines 169-224; the `mutate` callback at ~line 371)
- Test: `packages/iso/src/__tests__/action.test.tsx` (add a `describe`); `packages/iso/src/__tests__/use-action-schema.test-d.ts` (create)

**Interfaces:**
- Consumes: `logClientSchemaThrew` (Task 1); `validateWithSchema` / `ValidationResult` from `./validate.js`; `VALIDATION_ISSUES_KEY` from `./internal/contract.js`; the existing local `recordOutcome`, `setError`, `stubRef`, `optionsRef`.
- Produces: `UseActionOptions`'s `schema?: StandardSchemaV1<unknown, TPayload>`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/iso/src/__tests__/action.test.tsx` (it already imports `renderHook`, `act`, `waitFor`, `vi`, `useAction`, `getLastActionResult`, `clearLastActionResult`, and defines a `stub`). Add these imports at the top of the file's import block: `import { getValidationIssues } from '../get-validation-issues.js';` and `import type { StandardSchemaV1 } from '@standard-schema/spec';`. Then add:

```ts
// A hand-rolled Standard Schema: `title` must be a non-empty string.
const titleSchema: StandardSchemaV1<unknown, { title: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (input: unknown) => {
      const v = input as { title?: unknown };
      return typeof v?.title === 'string' && v.title.length > 0
        ? { value: { title: v.title } }
        : { issues: [{ message: 'title is required', path: ['title'] }] };
    },
  },
};

const throwingSchema: StandardSchemaV1<unknown, { title: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => {
      throw new Error('schema exploded');
    },
  },
};

describe('useAction client pre-validation (schema)', () => {
  afterEach(() => clearLastActionResult('movies', 'create'));

  it('rejects an invalid payload locally without a fetch, as a deny(422)+issues', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const onMutate = vi.fn(() => 'snap');
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAction(stub, { schema: titleSchema, onMutate, onError })
    );

    let outcome!: MutateResult<{ ok: boolean }>;
    await act(async () => {
      outcome = await result.current.mutate({ title: '' });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toBe('Validation failed');
    expect(result.current.pending).toBe(false);
    expect(onMutate).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    const recorded = getLastActionResult('movies', 'create');
    const issues = getValidationIssues(recorded);
    expect(issues).toEqual([{ message: 'title is required', path: ['title'] }]);
  });

  it('sends the original payload when the schema passes', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ __outcome: 'success', data: { ok: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useAction(stub, { schema: titleSchema }));
    await act(async () => {
      await result.current.mutate({ title: 'Dune' });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.payload).toEqual({ title: 'Dune' });
  });

  it('fails open when the schema throws (request proceeds to the server)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ __outcome: 'success', data: { ok: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() =>
      useAction(stub, { schema: throwingSchema })
    );
    await act(async () => {
      await result.current.mutate({ title: '' });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm vitest run packages/iso/src/__tests__/action.test.tsx`
Expected: FAIL — `schema` is not accepted / not honored (the invalid case still fetches).

- [ ] **Step 3: Add the imports**

In `packages/iso/src/action.ts`, add to the existing `./internal/contract.js` import so it reads:

```ts
import {
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
  VALIDATION_ISSUES_KEY,
} from './internal/contract.js';
```

And add a new import:

```ts
import {
  validateWithSchema,
  logClientSchemaThrew,
  type ValidationResult,
} from './validate.js';
```

- [ ] **Step 4: Thread `TPayload` and add the `schema` field**

Replace the options type block (`UseActionOptionsCommon` through `UseActionOptions`, ~lines 169-224) with:

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

type UseActionWithoutMutate<TPayload, TResult, TChunk> =
  UseActionOptionsCommon<TPayload, TChunk> & {
    onMutate?: undefined;
    onError?: (err: Error) => void;
    onSuccess?: (data: Serialize<TResult>) => void;
  };

export type UseActionOptions<
  TPayload,
  TResult,
  TChunk = never,
  TSnapshot = unknown,
> =
  | UseActionWithMutate<TPayload, TResult, TChunk, TSnapshot>
  | UseActionWithoutMutate<TPayload, TResult, TChunk>;
```

(Only the private base and `UseActionWithoutMutate` gained the `TPayload` parameter; the exported `UseActionOptions` generic order is unchanged, so no call site breaks.)

- [ ] **Step 5: Add the gate at the top of `mutate`**

In the `mutate` `useCallback` (starts ~line 371), insert the gate as the FIRST statements in the async body, before `const controller = new AbortController();`:

```ts
    async (
      payload: TPayload,
      opts?: { signal?: AbortSignal }
    ): Promise<MutateResult<TResult>> => {
      // Client pre-validation gate: reject a known-invalid payload before any
      // side effect (no onMutate, no optimistic, no request), surfacing it as
      // the same deny(422)+issues the server produces. Fail open on a throwing
      // schema. pending never flips true on this path.
      const gateStub = stubRef.current;
      const schema = optionsRef.current?.schema;
      if (schema) {
        let validated: ValidationResult<TPayload> | undefined;
        try {
          validated = await validateWithSchema(schema, payload);
        } catch (err) {
          logClientSchemaThrew(err);
        }
        if (validated && !validated.ok) {
          const error = new Error('Validation failed');
          recordOutcome(gateStub.__module, gateStub.__action, {
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

      const controller = new AbortController();
      // ... existing body continues unchanged ...
```

- [ ] **Step 6: Run the tests, verify they pass**

Run: `pnpm vitest run packages/iso/src/__tests__/action.test.tsx`
Expected: PASS (the new cases plus the pre-existing ones).

- [ ] **Step 7: Add the type-level test**

Create `packages/iso/src/__tests__/use-action-schema.test-d.ts`:

```ts
import { expectTypeOf } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { UseActionOptions } from '../action.js';

// schema is optional and typed to the payload.
expectTypeOf<
  UseActionOptions<{ title: string }, { ok: boolean }>['schema']
>().toEqualTypeOf<StandardSchemaV1<unknown, { title: string }> | undefined>();

// A schema whose output mismatches the payload is a type error.
const wrong = {} as StandardSchemaV1<unknown, { nope: number }>;
// @ts-expect-error output shape must match the action payload
const _bad: UseActionOptions<{ title: string }, unknown> = { schema: wrong };
```

- [ ] **Step 8: Run the type test**

Run: `pnpm test:types`
Expected: PASS.

- [ ] **Step 9: Mutation-check**

Temporarily change the recorded `status: 422` to `status: 200` (or the message to something else). Run `action.test.tsx`; expected: the `getValidationIssues`/message assertions FAIL. Restore; re-run; PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/iso/src/action.ts packages/iso/src/__tests__/action.test.tsx packages/iso/src/__tests__/use-action-schema.test-d.ts
git commit -m "feat(#154): opt-in client pre-validation for useAction via a schema option"
```

---

## Task 3: Docs

**Files:**
- Modify: the actions / form-validation docs page under `apps/site/src/pages/docs/`

- [ ] **Step 1: Find the page**

Run: `rg -l "Form|schema|useAction|getValidationIssues|validation" apps/site/src/pages/docs -g '*.mdx'` and read the closest fit (the form-validation / actions page that documents `<Form schema>` and `getValidationIssues`). Match its heading style and voice.

- [ ] **Step 2: Add a `useAction({ schema })` subsection**

Add a subsection beside the `<Form schema>` docs showing the imperative parity. Adapt to the page voice; keep the meaning:

```mdx
### Pre-validating an imperative action

`useAction` takes the same opt-in `schema` as `<Form>`, so an imperatively
driven action gets the same client-side gate:

```tsx
import { create } from './movies.server';
import { movieSchema } from './movie-schema';
import { useAction, useActionResult, getValidationIssues } from 'hono-preact';

function AddMovie() {
  const { mutate } = useAction(create, { schema: movieSchema });
  const issues = getValidationIssues(useActionResult(create));
  // ...
}
```

An invalid payload is rejected locally (no request) and surfaces as the same
`deny(422)` a server validation failure produces, so `getValidationIssues`
decodes both the same way. If the schema's validate throws, the request proceeds
and the server validates. The server always re-validates; the client gate never
changes what is sent.
```

Do not add historical / migration breadcrumbs; describe what is. No em-dashes.

- [ ] **Step 3: Verify the docs gates still pass**

Run: `pnpm gen:agents-corpus && pnpm vitest run apps/site/src/pages/docs/__tests__/exports-coverage.test.ts`
Expected: PASS (no new runtime export is introduced; `schema` is an option field, so the coverage gate is unaffected, but regenerate the corpus for consistency).

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs
git commit -m "docs(#154): document useAction({ schema }) client pre-validation"
```

---

## Final verification (before PR / review)

- [ ] Run the 8 CI-parity checks from `CLAUDE.md` in order: build; `pnpm gen:agents-corpus`; `pnpm format:check`; `pnpm typecheck`; `pnpm test:types`; `pnpm test` (or `test:coverage`); `pnpm test:integration`; `pnpm --filter site build`.
- [ ] Confirm the full suite is green and `format:check` is clean.

---

## Self-review notes (coverage against the spec)

- Client-supplied `schema` option (type-threaded, typed to payload): Task 2 (steps 4, 7).
- Gate before any side effect, fail open, byte-identical `deny(422)` outcome, `getValidationIssues` parity, no onMutate/onError/optimistic, pending stays false, error set: Task 2 (step 5, tests step 1).
- Gate-only (original payload sent, server authoritative): Task 2 (the "sends the original payload" test).
- Shared `logClientSchemaThrew` (DRY): Task 1.
- Docs: Task 3.
