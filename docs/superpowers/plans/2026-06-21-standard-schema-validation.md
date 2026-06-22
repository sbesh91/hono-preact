# Standard Schema payload validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add library-agnostic payload validation (Standard Schema) to actions, forms, and loaders, enforced authoritatively on the server with opt-in client pre-validation.

**Architecture:** A tiny `validate.ts` core in `@hono-preact/iso` wraps `schema['~standard'].validate`. Schemas attach as define-time options (`defineAction({ input })`, `defineLoader({ searchSchema, paramsSchema })`, `<Form schema>`). The two server handlers (`pageActionHandler`, `loadersHandler`) enforce at the innermost seam (after middleware, before the user fn). Action failures become `deny(422)` with normalized issues under a reserved key in `deny.data`; loader failures throw `deny(400/404)` to the error boundary. The client-facing payload type is the schema's `InferOutput`, uniformly.

**Tech Stack:** TypeScript, Preact, Hono, Vitest (+ `--typecheck` mode for `*.test-d.ts`), `@standard-schema/spec` (types-only runtime dep), Zod (test devDependency only).

## Global Constraints

- **Library-agnostic runtime.** The only new framework runtime dependency is `@standard-schema/spec` (types only). Never import Zod/Valibot/ArkType from framework source. A concrete validator (Zod) appears only as a **devDependency** for tests.
- **No framework coercion.** The framework passes the raw payload as the schema `Input`. Coercing FormData strings is the schema author's job.
- **Client-facing payload type is `InferOutput`** for `mutate`, `<Form>`, and the handler, uniformly (single `TPayload` param).
- **Reuse `deny`, no new envelope tag.** Validation failures are `deny(422, msg, { data: { [VALIDATION_ISSUES_KEY]: issues } })`.
- **Loader schema option names are `searchSchema` / `paramsSchema`** (not `search`/`params`): `DefineLoaderOpts.params` already exists (cache-key dependency list, `string[] | '*'`).
- **Loader schema coercion is scoped to non-live loaders** for v1.
- **No em-dashes** in prose, comments, or commit messages (use commas/colons/parentheses).
- **Prefer reshape over cast** (CLAUDE.md). Accepted cast boundaries follow CLAUDE.md: parsing untrusted JSON / wire (reading the issues array off `deny.data`), reading FormData entries (the existing `collectFormData(fd) as TPayload`), and structural reads off user-defined module exports (reading schema metadata off a `defineAction` value or a `LoaderRef`). The existing `defineAction` dual-shape `as unknown as` return also stands. Introduce NO new casts in framework `src` beyond these; in particular the loader handler reshapes (widens the internal `LoaderFn` location to `unknown`), it does not cast, to pass coerced values. Test fixtures may use casts as the existing tests do.
- **Run `pnpm format` before every commit.** The recurring trap in this repo is committing format-dirty files that pass `format:check` in the working tree but not in the commit. After staging, run `pnpm format` then re-stage.
- **Node engine warning is expected** (worktree runs Node 24.10 vs wanted `^22.18 || >=24.11`); it is a warning, not a failure.
- **Serena is unavailable in this worktree** (it indexes the main checkout). Use `rg`/Read/Edit only.

## Reference: exact current shapes (read before editing)

- `packages/iso/src/action.ts`: `DefineActionOpts<TChunk, TResult>`, `ActionStub<TPayload, TResult, TChunk>`, `ActionFn`, `defineAction` (single signature, `attach` helper with key union `'use' | 'timeoutMs' | '__module' | '__action'`), `useAction`.
- `packages/iso/src/define-loader.ts`: `LoaderCtx<TParams>`, `Loader<T, TParams>`, `LoaderRef<T, Live>` (has `readonly params: string[] | '*'`), `DefineLoaderOpts<T>` (has `params?: string[] | '*'`), four `defineLoader` overloads + impl.
- `packages/iso/src/server-route.ts`: `RouteServer.loader<T>(fn, opts?)`.
- `packages/iso/src/form.tsx`: `FormProps<TPayload, TResult>`, `collectFormData`, `Form` (handleSubmit, renders `<form><fieldset>{children}</fieldset></form>`).
- `packages/iso/src/use-action-result.ts`: `ActionResult<TPayload, TResult>` (deny variant has `data?: unknown`), `useActionResult(stub?)`.
- `packages/iso/src/outcomes.ts`: `deny(status, message?, { data })`.
- `packages/iso/src/internal/contract.ts`: cross-package constants.
- `packages/iso/src/internal-runtime.ts`: framework-emitted door (`export * from './internal/contract.js'` already present).
- `packages/iso/src/index.ts`: public barrel.
- `packages/server/src/page-action-resolvers.ts`: `ActionEntry`, `extractActions`.
- `packages/server/src/page-action-handler.ts`: `pageActionHandler`, the `inner` thunk calling `fn(actionCtx, payload)`.
- `packages/server/src/loaders-handler.ts`: `LoaderEntry`, `LoaderFn`, `buildLoadersMap`, `validateLocation`, `loadersHandler` (the `inner` thunk calling `entry.fn({ c, location, signal })`, the `catch (err) { if (isOutcome(err)) return translateOutcomeForLoader(c, err) }`).

---

## Task 1: Validation core (iso)

**Files:**
- Modify: `packages/iso/package.json` (add `@standard-schema/spec` to `dependencies`)
- Create: `packages/iso/src/validate.ts`
- Modify: `packages/iso/src/internal/contract.ts` (add `VALIDATION_ISSUES_KEY`)
- Modify: `packages/iso/src/internal-runtime.ts` (export `validateWithSchema`, `normalizeIssues`, `mapIssuesToFields`)
- Test: `packages/iso/src/__tests__/validate.test.ts`

**Interfaces:**
- Produces: `validateWithSchema<S extends StandardSchemaV1>(schema: S, input: unknown): Promise<ValidationResult<StandardSchemaV1.InferOutput<S>>>`; `normalizeIssues(issues): ValidationIssue[]`; `mapIssuesToFields(issues: ValidationIssue[] | null): Record<string, string[]>`; types `ValidationIssue`, `ValidationResult<T>`; const `VALIDATION_ISSUES_KEY = '__hpValidationIssues'`.

- [ ] **Step 1: Add the dependency**

```bash
cd packages/iso && pnpm add @standard-schema/spec@^1.0.0 && cd ../..
pnpm install
```
Verify `packages/iso/package.json` now lists `"@standard-schema/spec": "^1.0.0"` under `dependencies` (NOT devDependencies). It is types-only at runtime.

- [ ] **Step 2: Write the failing test** at `packages/iso/src/__tests__/validate.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
  validateWithSchema,
  normalizeIssues,
  mapIssuesToFields,
} from '../validate.js';

// Hand-rolled Standard Schema so the adapter is tested against the raw spec,
// not one vendor's quirks. `make` builds a schema whose validate runs `check`.
function make<I, O>(
  check: (v: unknown) =>
    | { value: O }
    | { issues: ReadonlyArray<StandardSchemaV1.Issue> },
  async = false
): StandardSchemaV1<I, O> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (v) => (async ? Promise.resolve(check(v)) : check(v)),
    },
  };
}

describe('validateWithSchema', () => {
  it('returns ok+value for a sync passing schema', async () => {
    const schema = make<unknown, number>(() => ({ value: 42 }));
    const res = await validateWithSchema(schema, '42');
    expect(res).toEqual({ ok: true, value: 42 });
  });

  it('awaits an async schema', async () => {
    const schema = make<unknown, string>(() => ({ value: 'x' }), true);
    const res = await validateWithSchema(schema, 'anything');
    expect(res).toEqual({ ok: true, value: 'x' });
  });

  it('returns ok:false with normalized issues on failure', async () => {
    const schema = make<unknown, never>(() => ({
      issues: [
        { message: 'Required', path: ['title'] },
        { message: 'Too small', path: ['address', { key: 'zip' }] },
        { message: 'Bad item', path: ['tags', 0] },
        { message: 'Whole-object problem' },
      ],
    }));
    const res = await validateWithSchema(schema, {});
    expect(res).toEqual({
      ok: false,
      issues: [
        { path: ['title'], message: 'Required' },
        { path: ['address', 'zip'], message: 'Too small' },
        { path: ['tags', 0], message: 'Bad item' },
        { path: [], message: 'Whole-object problem' },
      ],
    });
  });
});

describe('normalizeIssues', () => {
  it('coerces object path segments to their key and keeps numbers', () => {
    expect(
      normalizeIssues([{ message: 'm', path: [{ key: 'a' }, 2, 'b'] }])
    ).toEqual([{ path: ['a', 2, 'b'], message: 'm' }]);
  });
});

describe('mapIssuesToFields', () => {
  it('groups messages by dot-joined path; null -> {}', () => {
    expect(mapIssuesToFields(null)).toEqual({});
    expect(
      mapIssuesToFields([
        { path: ['title'], message: 'a' },
        { path: ['title'], message: 'b' },
        { path: ['address', 'zip'], message: 'c' },
        { path: [], message: 'form-level' },
      ])
    ).toEqual({
      title: ['a', 'b'],
      'address.zip': ['c'],
      '': ['form-level'],
    });
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm vitest run packages/iso/src/__tests__/validate.test.ts`
Expected: FAIL ("Cannot find module '../validate.js'").

- [ ] **Step 4: Create `packages/iso/src/validate.ts`**

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

/** A single validation problem, normalized off a Standard Schema issue. */
export type ValidationIssue = {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
};

/** Result of running a schema: the validated output or the issues. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

function normalizeKey(key: PropertyKey): string | number {
  return typeof key === 'number' ? key : String(key);
}

/**
 * Normalize Standard Schema issues into the framework's field-error shape.
 * Each path segment is either a `PropertyKey` or `{ key: PropertyKey }`; both
 * collapse to a `string | number`. Symbols stringify (form/loader keys are
 * never symbols in practice).
 */
export function normalizeIssues(
  issues: ReadonlyArray<StandardSchemaV1.Issue>
): ValidationIssue[] {
  return issues.map((issue) => ({
    message: issue.message,
    path: (issue.path ?? []).map((seg) =>
      typeof seg === 'object' && seg !== null
        ? normalizeKey(seg.key)
        : normalizeKey(seg)
    ),
  }));
}

/**
 * Run a Standard Schema against `input`. Awaits async schemas. Returns a
 * discriminated result so callers branch without touching the raw spec shape.
 */
export async function validateWithSchema<S extends StandardSchemaV1>(
  schema: S,
  input: unknown
): Promise<ValidationResult<StandardSchemaV1.InferOutput<S>>> {
  let result = schema['~standard'].validate(input);
  if (result instanceof Promise) result = await result;
  if (result.issues) {
    return { ok: false, issues: normalizeIssues(result.issues) };
  }
  return { ok: true, value: result.value };
}

/**
 * Group normalized issues into a field-error map keyed by the dot-joined path
 * (`['address','zip'] -> "address.zip"`; an empty path -> `""`, a form-level
 * error). Used by `<Form>` and `useFieldErrors`.
 */
export function mapIssuesToFields(
  issues: ValidationIssue[] | null
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!issues) return out;
  for (const issue of issues) {
    const key = issue.path.join('.');
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
```

- [ ] **Step 5: Add the reserved key** to `packages/iso/src/internal/contract.ts` (append at end)

```ts
/**
 * Reserved key under `deny.data` carrying normalized validation issues
 * (`ValidationIssue[]`). Consumers: server `page-action-handler.ts` (writes it
 * on a schema-failure `deny(422)`), iso `get-validation-issues.ts` (reads it).
 * A schema-failure deny is otherwise indistinguishable from an app-level deny;
 * this framework-owned key is the contract that keeps them apart.
 */
export const VALIDATION_ISSUES_KEY = '__hpValidationIssues';
```

- [ ] **Step 6: Export the core from the framework-emitted door** in `packages/iso/src/internal-runtime.ts` (add after the existing `export * from './internal/contract.js';`)

```ts
export {
  validateWithSchema,
  normalizeIssues,
  mapIssuesToFields,
  type ValidationIssue,
  type ValidationResult,
} from './validate.js';
```

- [ ] **Step 7: Run the test to confirm it passes**

Run: `pnpm vitest run packages/iso/src/__tests__/validate.test.ts`
Expected: PASS (all cases).

- [ ] **Step 8: Format, stage, commit**

```bash
pnpm format
git add packages/iso/package.json pnpm-lock.yaml packages/iso/src/validate.ts packages/iso/src/internal/contract.ts packages/iso/src/internal-runtime.ts packages/iso/src/__tests__/validate.test.ts
git commit -m "feat(iso): Standard Schema validation core (validateWithSchema)"
```

---

## Task 2: defineAction `input` option + type inference

**Files:**
- Modify: `packages/iso/src/action.ts`
- Test (type): `packages/iso/src/__tests__/define-action-input.test-d.ts`
- Test (runtime): `packages/iso/src/__tests__/define-action-input.test.ts`

**Interfaces:**
- Consumes: `StandardSchemaV1` (from `@standard-schema/spec`).
- Produces: `DefineActionOpts.input?: StandardSchemaV1`; a `defineAction` overload where, given `{ input }`, the handler payload and the stub `TPayload` are both `StandardSchemaV1.InferOutput<typeof input>`. The schema is attached as a non-enumerable `input` property on the returned fn (read by `extractActions` in Task 3).

- [ ] **Step 1: Write the failing type test** at `packages/iso/src/__tests__/define-action-input.test-d.ts`

```ts
import { expectTypeOf } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineAction } from '../action.js';
import type { ActionStub } from '../action.js';

declare const NewTask: StandardSchemaV1<
  { title: string; count: string },
  { title: string; count: number }
>;

function _probes() {
  // With `input`: handler payload is InferOutput; stub TPayload is InferOutput.
  const create = defineAction(
    async (_ctx, payload) => {
      expectTypeOf(payload).toEqualTypeOf<{ title: string; count: number }>();
      return { id: 1 };
    },
    { input: NewTask }
  );
  expectTypeOf(create).toEqualTypeOf<
    ActionStub<{ title: string; count: number }, { id: number }, never>
  >();

  // Without `input`: payload generic still inferred from usage (existing).
  const plain = defineAction(async (_ctx, payload: { x: number }) => payload.x);
  expectTypeOf(plain).toEqualTypeOf<ActionStub<{ x: number }, number, never>>();
}

void _probes;
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run --typecheck.only packages/iso/src/__tests__/define-action-input.test-d.ts`
Expected: FAIL (`input` not assignable to `DefineActionOpts`; payload is not narrowed).

- [ ] **Step 3: Edit `packages/iso/src/action.ts`**

3a. Add the import near the top:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';
```

3b. Add `input` to `DefineActionOpts` (inside the type, alongside `use`/`timeoutMs`):

```ts
  /**
   * Standard Schema validating the action payload. When provided, the handler
   * receives the schema's validated output (`InferOutput`) and the client-facing
   * stub's payload type is the same `InferOutput`. The server enforces it before
   * the handler runs; a failure becomes `deny(422)` with issues. The framework
   * does not coerce, the schema does (e.g. `z.coerce.number()`).
   */
  input?: StandardSchemaV1;
```

3c. Replace the single `defineAction` signature with two overloads + an impl. The first overload captures the input-schema case; the second is the existing signature verbatim. The impl widens to attach metadata only (it never calls `fn`).

```ts
export function defineAction<
  TInput extends StandardSchemaV1,
  TResult,
  TChunk = never,
>(
  fn: ActionFn<StandardSchemaV1.InferOutput<TInput>, TResult, TChunk>,
  opts: DefineActionOpts<TChunk, TResult> & { input: TInput }
): ActionStub<StandardSchemaV1.InferOutput<TInput>, TResult, TChunk>;
export function defineAction<TPayload, TResult, TChunk = never>(
  fn: ActionFn<TPayload, TResult, TChunk>,
  opts?: DefineActionOpts<TChunk, TResult>
): ActionStub<TPayload, TResult, TChunk>;
export function defineAction(
  fn: ActionFn<never, unknown, never>,
  opts?: DefineActionOpts<never, unknown>
): ActionStub<never, unknown, never> {
  validateTimeoutMs(opts?.timeoutMs, 'defineAction');
  // (existing SHAPE NOTE comment block stays here unchanged)
  const attach = (
    key: 'use' | 'timeoutMs' | '__module' | '__action' | 'input',
    value: unknown
  ) => {
    Object.defineProperty(fn, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  };
  if (opts?.use) attach('use', opts.use);
  if (opts?.timeoutMs !== undefined) attach('timeoutMs', opts.timeoutMs);
  if (opts?.input) attach('input', opts.input);
  if (opts?.__module !== undefined) attach(FORM_MODULE_FIELD, opts.__module);
  if (opts?.__action !== undefined) attach(FORM_ACTION_FIELD, opts.__action);
  return fn as unknown as ActionStub<never, unknown, never>;
}
```

Notes for the implementer:
- Keep the existing SHAPE NOTE comment that documents the dual-shape `as unknown as` return.
- The impl param `ActionFn<never, unknown, never>` is the standard permissive overload-impl shape (`never` is the bottom for the contravariant payload, so every overload's `fn` is assignable). If TS rejects the impl signature, widen the payload to `unknown` only on the impl line is NOT enough (contravariance) - use `never`. This mirrors `defineLoader`'s permissive impl signature.

- [ ] **Step 4: Run the type test to confirm it passes**

Run: `pnpm vitest run --typecheck.only packages/iso/src/__tests__/define-action-input.test-d.ts`
Expected: PASS.

- [ ] **Step 5: Write + run the runtime metadata test** at `packages/iso/src/__tests__/define-action-input.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineAction } from '../action.js';

const schema: StandardSchemaV1<unknown, unknown> = {
  '~standard': { version: 1, vendor: 'test', validate: (v) => ({ value: v }) },
};

describe('defineAction input metadata', () => {
  it('attaches the schema as a non-enumerable `input` property', () => {
    const stub = defineAction(async () => 'ok', { input: schema });
    // Read it the way extractActions does (off the function value).
    expect((stub as unknown as { input?: unknown }).input).toBe(schema);
    // Non-enumerable: must not appear in Object.keys.
    expect(Object.keys(stub as object)).not.toContain('input');
  });

  it('omits `input` when no schema is given', () => {
    const stub = defineAction(async () => 'ok');
    expect((stub as unknown as { input?: unknown }).input).toBeUndefined();
  });
});
```

Run: `pnpm vitest run packages/iso/src/__tests__/define-action-input.test.ts`
Expected: PASS.

- [ ] **Step 6: Format, stage, commit**

```bash
pnpm format
git add packages/iso/src/action.ts packages/iso/src/__tests__/define-action-input.test-d.ts packages/iso/src/__tests__/define-action-input.test.ts
git commit -m "feat(iso): defineAction input schema option + payload inference"
```

---

## Task 3: Server action enforcement

**Files:**
- Modify: `packages/server/src/page-action-resolvers.ts` (`ActionEntry` gains `input?`; `extractActions` reads it)
- Modify: `packages/server/src/page-action-handler.ts` (validate in the `inner` thunk)
- Test: `packages/server/src/__tests__/page-action-handler.test.ts` (add validation cases)
- Test: `packages/server/src/__tests__/page-action-resolvers.test.ts` (extractActions reads `input`)

**Interfaces:**
- Consumes: `ActionEntry.input?: StandardSchemaV1` (this task adds it); `validateWithSchema`, `VALIDATION_ISSUES_KEY` (from `@hono-preact/iso/internal/runtime`); `deny` (from `@hono-preact/iso`).
- Produces: on schema failure, a `deny(422, 'Validation failed', { data: { [VALIDATION_ISSUES_KEY]: issues } })` outcome; on success the handler runs with the validated output.

- [ ] **Step 1: Write the failing handler test** - add to `packages/server/src/__tests__/page-action-handler.test.ts`

Extend the `buildHandler` fixture to thread an optional `input` onto the entry, then add cases. The fixture currently builds `map.set(name, { fn, use: [], moduleKey })`. Change it to accept entries that may carry `input`:

```ts
// Replace the `actions` param shape so a value can be a bare fn OR { fn, input }.
function buildHandler(
  actions: Record<
    string,
    | ((ctx: unknown, payload: unknown) => Promise<unknown>)
    | {
        fn: (ctx: unknown, payload: unknown) => Promise<unknown>;
        input?: import('@standard-schema/spec').StandardSchemaV1;
      }
  >
) {
  const resolverByPath = async () => {
    const map = new Map();
    for (const [name, val] of Object.entries(actions)) {
      const entry = typeof val === 'function' ? { fn: val } : val;
      map.set(name, {
        fn: entry.fn,
        use: [],
        moduleKey: 'pages/test.server',
        input: entry.input,
      });
    }
    return map;
  };
  // ...rest of buildHandler unchanged (renderPage, return pageActionHandler({...}))
}
```

Add at the top of the file:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { VALIDATION_ISSUES_KEY } from '@hono-preact/iso/internal/runtime';

const failing: StandardSchemaV1<unknown, unknown> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: () => ({ issues: [{ message: 'Required', path: ['title'] }] }),
  },
};
const coercing: StandardSchemaV1<unknown, { count: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => ({
      value: { count: Number((v as { count: unknown }).count) },
    }),
  },
};
```

Add these cases inside `describe('pageActionHandler', ...)`:

```ts
it('returns deny(422) JSON envelope with issues when input schema fails', async () => {
  const fn = vi.fn(async () => ({ id: 1 }));
  const handler = buildHandler({ submit: { fn, input: failing } });
  const app = new Hono().post('*', handler);
  const res = await app.request('/foo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      module: 'pages/test.server',
      action: 'submit',
      payload: {},
    }),
  });
  expect(res.status).toBe(422);
  const body = await res.json();
  expect(body.__outcome).toBe('deny');
  expect(body.data[VALIDATION_ISSUES_KEY]).toEqual([
    { path: ['title'], message: 'Required' },
  ]);
  expect(fn).not.toHaveBeenCalled(); // handler never ran
});

it('passes the coerced output to the handler when the schema passes', async () => {
  let seen: unknown;
  const fn = vi.fn(async (_ctx: unknown, payload: unknown) => {
    seen = payload;
    return 'ok';
  });
  const handler = buildHandler({ submit: { fn, input: coercing } });
  const app = new Hono().post('*', handler);
  const res = await app.request('/foo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      module: 'pages/test.server',
      action: 'submit',
      payload: { count: '3' },
    }),
  });
  expect(res.status).toBe(200);
  expect(seen).toEqual({ count: 3 }); // coercion observable to the handler
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run packages/server/src/__tests__/page-action-handler.test.ts`
Expected: FAIL (422 case returns 200 because no enforcement yet; coercion case sees `{ count: '3' }`).

- [ ] **Step 3: Add `input` to `ActionEntry` and read it in `extractActions`** (`packages/server/src/page-action-resolvers.ts`)

3a. Add the import:

```ts
import type { ServerRoute, StandardSchemaV1 } from '@hono-preact/iso';
```
(replace the existing `import type { ServerRoute } from '@hono-preact/iso';`)

3b. Add the field to `ActionEntry`:

```ts
export type ActionEntry = {
  fn: ActionFn;
  use: ReadonlyArray<unknown>;
  timeoutMs?: number | false;
  moduleKey: string;
  input?: StandardSchemaV1;
};
```

3c. Read it in `extractActions` (extend the `metadata` shape and the pushed entry):

```ts
    const metadata = val as {
      use?: ReadonlyArray<unknown>;
      timeoutMs?: number | false;
      input?: StandardSchemaV1;
    };
    out.push({
      name,
      entry: {
        fn: val as ActionFn,
        use: metadata.use ?? [],
        timeoutMs: metadata.timeoutMs,
        moduleKey,
        input: metadata.input,
      },
    });
```

- [ ] **Step 4: Enforce in `pageActionHandler`** (`packages/server/src/page-action-handler.ts`)

4a. Add `deny` to the iso import and the validation core to the runtime import:

```ts
import {
  isOutcome,
  timeoutOutcome,
  deny,
  type AppConfig,
  type ServerActionCtx,
} from '@hono-preact/iso';
```
```ts
import {
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
  VALIDATION_ISSUES_KEY,
  validateWithSchema,
} from '@hono-preact/iso/internal/runtime';
```

4b. After `const { fn, use: actionUse, timeoutMs } = entry;`, the `inner` thunk currently is:

```ts
          inner: async () => {
            const inner = await fn(actionCtx, payload);
            if (isOutcome(inner)) throw inner;
            return inner;
          },
```

Replace it with validation-then-call (validation runs after middleware, before the handler; the thrown `deny` is caught by the existing outcome path):

```ts
          inner: async () => {
            let effectivePayload: unknown = payload;
            if (entry.input) {
              const validated = await validateWithSchema(entry.input, payload);
              if (!validated.ok) {
                // Schema failure: short-circuit to a 422 deny carrying the
                // normalized issues under the reserved key. The handler never
                // runs. Caught below by `isOutcome(err)`, serialized into the
                // envelope (JSON) or the deny re-render (PE) like any deny.
                throw deny(422, 'Validation failed', {
                  data: { [VALIDATION_ISSUES_KEY]: validated.issues },
                });
              }
              effectivePayload = validated.value;
            }
            const inner = await fn(actionCtx, effectivePayload);
            if (isOutcome(inner)) throw inner;
            return inner;
          },
```

- [ ] **Step 5: Run handler tests to confirm pass**

Run: `pnpm vitest run packages/server/src/__tests__/page-action-handler.test.ts`
Expected: PASS (422 with issues, handler not called; coercion case sees `{ count: 3 }`).

- [ ] **Step 6: Add the resolver test** - in `packages/server/src/__tests__/page-action-resolvers.test.ts`, add a case proving `extractActions` surfaces `input`. Mirror that file's existing module-fixture style; the assertion:

```ts
it('reads the input schema off a defineAction value into the entry', async () => {
  // Build a fake server module whose serverActions carries a fn with a
  // non-enumerable `input` (as defineAction attaches it).
  const schema = {
    '~standard': { version: 1, vendor: 'test', validate: (v: unknown) => ({ value: v }) },
  };
  const fn = async () => 'ok';
  Object.defineProperty(fn, 'input', { value: schema, enumerable: false });
  const resolvers = makePageActionResolvers(
    [
      {
        path: '/foo',
        ancestors: [],
        server: async () => ({ __moduleKey: 'pages/foo.server', serverActions: { submit: fn } }),
      } as never,
    ],
    { dev: true }
  );
  const entry = await resolvers.byModuleKey('pages/foo.server', 'submit');
  expect(entry?.input).toBe(schema);
});
```
(Adjust the `ServerRoute` fixture fields to match the existing test's shape if it differs; the key assertion is `entry?.input === schema`.)

Run: `pnpm vitest run packages/server/src/__tests__/page-action-resolvers.test.ts`
Expected: PASS.

- [ ] **Step 7: Format, stage, commit**

```bash
pnpm format
git add packages/server/src/page-action-resolvers.ts packages/server/src/page-action-handler.ts packages/server/src/__tests__/page-action-handler.test.ts packages/server/src/__tests__/page-action-resolvers.test.ts
git commit -m "feat(server): enforce defineAction input schema (deny 422 with issues)"
```

---

## Task 4: Client issue helper (`getValidationIssues`)

**Files:**
- Create: `packages/iso/src/get-validation-issues.ts`
- Modify: `packages/iso/src/index.ts` (export `getValidationIssues`, `StandardSchemaV1`, `ValidationIssue`, `InferSchemaInput`, `InferSchemaOutput`)
- Test: `packages/iso/src/__tests__/get-validation-issues.test.ts`

**Interfaces:**
- Consumes: `ActionResult` (from `use-action-result.js`), `ValidationIssue` (from `validate.js`), `VALIDATION_ISSUES_KEY` (from `internal/contract.js`).
- Produces: `getValidationIssues(result: ActionResult<unknown, unknown>): ValidationIssue[] | null`. Public types: `StandardSchemaV1`, `ValidationIssue`, `InferSchemaInput<S>`, `InferSchemaOutput<S>`.

- [ ] **Step 1: Write the failing test** at `packages/iso/src/__tests__/get-validation-issues.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { getValidationIssues } from '../get-validation-issues.js';
import { VALIDATION_ISSUES_KEY } from '../internal/contract.js';

describe('getValidationIssues', () => {
  it('returns the issues array from a validation deny', () => {
    const issues = [{ path: ['title'], message: 'Required' }];
    const result = {
      kind: 'deny' as const,
      status: 422,
      message: 'Validation failed',
      data: { [VALIDATION_ISSUES_KEY]: issues },
      submittedPayload: {},
    };
    expect(getValidationIssues(result)).toEqual(issues);
  });

  it('returns null for a non-validation deny (app-level)', () => {
    const result = {
      kind: 'deny' as const,
      status: 403,
      message: 'Forbidden',
      data: { reason: 'unauthorized' },
      submittedPayload: {},
    };
    expect(getValidationIssues(result)).toBeNull();
  });

  it('returns null for success / error / null results', () => {
    expect(getValidationIssues(null)).toBeNull();
    expect(
      getValidationIssues({ kind: 'success', data: {}, submittedPayload: {} })
    ).toBeNull();
    expect(
      getValidationIssues({ kind: 'error', message: 'boom', submittedPayload: null })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run packages/iso/src/__tests__/get-validation-issues.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Create `packages/iso/src/get-validation-issues.ts`**

```ts
import type { ActionResult } from './use-action-result.js';
import type { ValidationIssue } from './validate.js';
import { VALIDATION_ISSUES_KEY } from './internal/contract.js';

/**
 * Extract normalized validation issues from an action result, or `null` when the
 * result is not a schema-validation failure. A validation failure is a `deny`
 * whose `data` carries the framework-reserved `VALIDATION_ISSUES_KEY`; this is
 * what distinguishes it from an app-level `deny`. Pair with `useActionResult`:
 *
 * ```tsx
 * const result = useActionResult(create);
 * const issues = getValidationIssues(result); // ValidationIssue[] | null
 * ```
 */
export function getValidationIssues(
  result: ActionResult<unknown, unknown>
): ValidationIssue[] | null {
  if (!result || result.kind !== 'deny') return null;
  const { data } = result;
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as Record<string, unknown>)[VALIDATION_ISSUES_KEY];
  // `data` is untrusted wire JSON: this read is the sanctioned cast boundary
  // (same class as decodeActionResponse). We assert only that it is an array.
  if (!Array.isArray(raw)) return null;
  return raw as ValidationIssue[];
}
```

- [ ] **Step 4: Add the public exports** to `packages/iso/src/index.ts`. In the Forms section, after the `useActionResult` export, add exactly these lines:

```ts
export { getValidationIssues } from './get-validation-issues.js';
export type { StandardSchemaV1 } from '@standard-schema/spec';
export type { ValidationIssue } from './validate.js';
export type {
  InferSchemaInput,
  InferSchemaOutput,
} from './schema-types.js';
```

Then create `packages/iso/src/schema-types.ts` (the single inference reference point named in the spec):

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

/** The input type a Standard Schema accepts (pre-validation). */
export type InferSchemaInput<S extends StandardSchemaV1> =
  StandardSchemaV1.InferInput<S>;

/** The output type a Standard Schema produces (post-validation/coercion). */
export type InferSchemaOutput<S extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<S>;
```

- [ ] **Step 5: Run test to confirm pass**

Run: `pnpm vitest run packages/iso/src/__tests__/get-validation-issues.test.ts`
Expected: PASS.

- [ ] **Step 6: Format, stage, commit**

```bash
pnpm format
git add packages/iso/src/get-validation-issues.ts packages/iso/src/schema-types.ts packages/iso/src/index.ts packages/iso/src/__tests__/get-validation-issues.test.ts
git commit -m "feat(iso): getValidationIssues + public schema type exports"
```

---

## Task 5: `<Form>` client pre-validation + `useFieldErrors` + `<FieldError>`

**Files:**
- Create: `packages/iso/src/internal/field-errors-context.ts`
- Create: `packages/iso/src/use-field-errors.tsx`
- Modify: `packages/iso/src/form.tsx`
- Modify: `packages/iso/src/index.ts` (export `useFieldErrors`, `FieldError`)
- Test: `packages/iso/src/__tests__/form-validation.test.tsx`
- Test (type): `packages/iso/src/__tests__/form-schema.test-d.ts`

**Interfaces:**
- Consumes: `validateWithSchema`, `mapIssuesToFields` (from `validate.js`); `getValidationIssues` (Task 4); `useActionResult`; `StandardSchemaV1`.
- Produces: `FormProps.schema?: StandardSchemaV1<unknown, TPayload>`; `FieldErrorsContext` (a `Record<string, string[]>`); `useFieldErrors(): Record<string, string[]>`; `<FieldError name class? />`.

- [ ] **Step 1: Create the context** at `packages/iso/src/internal/field-errors-context.ts`

```ts
import { createContext } from 'preact';

/** Field name (dot-joined issue path) -> messages for that field. */
export type FieldErrorsMap = Record<string, string[]>;

/**
 * Carries a `<Form>`'s merged field errors (client pre-validation + server
 * `deny(422)` issues) to `useFieldErrors` / `<FieldError>` descendants.
 */
export const FieldErrorsContext = createContext<FieldErrorsMap>({});
```

- [ ] **Step 2: Create the consumer hook + component** at `packages/iso/src/use-field-errors.tsx`

```tsx
import { useContext } from 'preact/hooks';
import {
  FieldErrorsContext,
  type FieldErrorsMap,
} from './internal/field-errors-context.js';

/**
 * Read the enclosing `<Form>`'s merged field errors (client pre-validation plus
 * any server `deny(422)` issues), keyed by field name (the issue path joined by
 * `.`). Returns `{}` outside a `<Form>`.
 */
export function useFieldErrors(): FieldErrorsMap {
  return useContext(FieldErrorsContext);
}

/**
 * Render the first error message for `name`, or nothing. A thin convenience
 * wrapper over `useFieldErrors`; use the hook directly for custom rendering.
 */
export function FieldError({
  name,
  class: className,
}: {
  name: string;
  class?: string;
}) {
  const errors = useFieldErrors();
  const message = errors[name]?.[0];
  if (!message) return null;
  return (
    <span class={className} data-field-error={name} role="alert">
      {message}
    </span>
  );
}
```

- [ ] **Step 3: Write the failing tests** at `packages/iso/src/__tests__/form-validation.test.tsx`

Mirror the harness in the existing `form.test.tsx` (render with `@testing-library/preact`, flush with `act`). Use a hand-rolled schema so no validator dep is needed.

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, fireEvent } from '@testing-library/preact';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Form } from '../form.js';
import { FieldError } from '../use-field-errors.js';
import { defineAction } from '../action.js';

// title required; mirrors a real schema's failure on empty title.
const schema: StandardSchemaV1<unknown, { title: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      const title = (v as { title?: unknown }).title;
      return typeof title === 'string' && title.length > 0
        ? { value: { title } }
        : { issues: [{ message: 'Title is required', path: ['title'] }] };
    },
  },
};

const create = defineAction(async () => ({ id: 1 }), {
  input: schema,
  __module: 'pages/test.server',
  __action: 'create',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Form client pre-validation', () => {
  it('blocks the POST and shows field errors when invalid', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const { getByText, queryByText, container } = render(
      <Form action={create} schema={schema}>
        <input name="title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(getByText('Title is required')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled(); // POST blocked
  });

  it('clears a field error on input once it becomes valid', async () => {
    const { getByText, queryByText, container } = render(
      <Form action={create} schema={schema}>
        <input name="title" />
        <FieldError name="title" />
        <button type="submit">Save</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(getByText('Title is required')).toBeTruthy();
    const input = container.querySelector('input[name="title"]')!;
    await act(async () => {
      fireEvent.input(input, { target: { value: 'Hello' } });
    });
    expect(queryByText('Title is required')).toBeNull(); // live-cleared
  });

  it('proceeds with the POST when valid', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ __outcome: 'success', data: { id: 1 } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      );
    const { container } = render(
      <Form action={create} schema={schema}>
        <input name="title" value="Hello" />
        <button type="submit">Save</button>
      </Form>
    );
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
```

Run: `pnpm vitest run packages/iso/src/__tests__/form-validation.test.tsx`
Expected: FAIL (`schema` prop unknown; no field-error rendering; POST not blocked).

- [ ] **Step 4: Edit `packages/iso/src/form.tsx`**

4a. Add imports:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { validateWithSchema, mapIssuesToFields } from './validate.js';
import { getValidationIssues } from './get-validation-issues.js';
import { useActionResult } from './use-action-result.js';
import {
  FieldErrorsContext,
  type FieldErrorsMap,
} from './internal/field-errors-context.js';
```
Add `useEffect` is not needed; ensure `useMemo`, `useRef`, `useState`, `useCallback` are imported (the file already imports `useState, useCallback, useMemo, useRef`).

4b. Add `schema` to `FormProps`:

```ts
  /**
   * Opt-in client-side pre-validation. Pass the SAME Standard Schema the action
   * declares as its `input` (author it in a shared, non-`.server` module so the
   * browser can import it). Typed to the action's payload so a mismatched schema
   * is a compile error. On submit the form runs it and blocks the POST on
   * failure; the server still re-validates authoritatively.
   */
  schema?: StandardSchemaV1<unknown, TPayload>;
```

4c. In the `Form` function, destructure `schema` from props and add the field-error state + merged map. After the existing `const [pending, setPending] = useState(false);`:

```ts
  const [clientErrors, setClientErrors] = useState<FieldErrorsMap>({});
  const clientErrorsRef = useRef(clientErrors);
  clientErrorsRef.current = clientErrors;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  // Server-returned validation issues (deny 422) for this action, if any.
  const plainStub = hasOptimisticBrand(action) ? undefined : action;
  const serverResult = useActionResult(plainStub);
  const fieldErrors = useMemo<FieldErrorsMap>(() => {
    const server = mapIssuesToFields(getValidationIssues(serverResult));
    // Client pre-validation reflects the most recent interaction, so it wins.
    return { ...server, ...clientErrors };
  }, [serverResult, clientErrors]);
```

4d. In `handleSubmit`, after `const payload = collectFormData(fd) as TPayload;` and BEFORE `let handle ...`, insert the client gate:

```ts
      if (schemaRef.current) {
        const result = await validateWithSchema(schemaRef.current, payload);
        if (!result.ok) {
          setClientErrors(mapIssuesToFields(result.issues));
          return; // block the POST; server never sees an invalid payload
        }
        // Valid: clear any prior client errors and fall through to POST.
        setClientErrors({});
      }
```
(`e.preventDefault()` already runs at the top of `handleSubmit`, so returning early leaves the default prevented.)

4e. Add a live-clear input handler. Define it as a `useCallback` near `handleSubmit`:

```ts
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
      const next = { ...prev };
      if (fresh[name]) next[name] = fresh[name];
      else delete next[name];
      return next;
    });
  }, []);
```

4f. Wire `onInput` on the `<form>` and wrap children in the provider. Change the returned JSX:

```tsx
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
```

4g. Update the `handleSubmit` `useCallback` to drop the `as TPayload` cast if it now reads cleanly, OR keep it (the existing cast is a sanctioned FormData boundary). Leave the existing `collectFormData(fd) as TPayload` cast in place; it is the documented FormData read boundary.

- [ ] **Step 5: Export the hook + component** in `packages/iso/src/index.ts` (Forms section):

```ts
export { useFieldErrors, FieldError } from './use-field-errors.js';
export type { FieldErrorsMap } from './internal/field-errors-context.js';
```

- [ ] **Step 6: Run the Form tests**

Run: `pnpm vitest run packages/iso/src/__tests__/form-validation.test.tsx`
Expected: PASS (block-on-invalid, live-clear, proceed-on-valid).

- [ ] **Step 7: Write + run the drift-safety type test** at `packages/iso/src/__tests__/form-schema.test-d.ts`

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Form } from '../form.js';
import { defineAction } from '../action.js';

declare const good: StandardSchemaV1<unknown, { title: string }>;
declare const wrong: StandardSchemaV1<unknown, { nope: number }>;

function _probes() {
  const create = defineAction(async (_c, _p: { title: string }) => 1, {
    __module: 'm',
    __action: 'a',
  });
  // OK: schema output matches the action payload.
  Form({ action: create, schema: good, children: null });
  // @ts-expect-error schema output { nope: number } != payload { title: string }
  Form({ action: create, schema: wrong, children: null });
}

void _probes;
```

Run: `pnpm vitest run --typecheck.only packages/iso/src/__tests__/form-schema.test-d.ts`
Expected: PASS (good accepted, wrong flagged by `@ts-expect-error`).

- [ ] **Step 8: Format, stage, commit**

```bash
pnpm format
git add packages/iso/src/internal/field-errors-context.ts packages/iso/src/use-field-errors.tsx packages/iso/src/form.tsx packages/iso/src/index.ts packages/iso/src/__tests__/form-validation.test.tsx packages/iso/src/__tests__/form-schema.test-d.ts
git commit -m "feat(iso): Form client pre-validation, useFieldErrors, FieldError"
```

---

## Task 6: Loader schema options + types (iso)

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Modify: `packages/iso/src/server-route.ts`
- Test (type): `packages/iso/src/__tests__/define-loader-schema.test-d.ts`
- Test (runtime): `packages/iso/src/__tests__/define-loader-schema.test.ts`

**Interfaces:**
- Produces: `DefineLoaderOpts.searchSchema?`, `DefineLoaderOpts.paramsSchema?`; `LoaderRef.searchSchema?`, `LoaderRef.paramsSchema?` (read by `buildLoadersMap` in Task 7); `LoaderCtx<TParams, TSearch>`; `Loader<T, TParams, TSearch>`; non-live `defineLoader` overloads that infer ctx types from the schemas; `serverRoute(id).loader` forwarding the same. Helper types `LoaderSchemaOpts`, `ParamsFromOpts<O, Fallback>`, `SearchFromOpts<O>`.

This formulation is verified by a tsc spike; it compiles and flows schema output into `ctx`.

- [ ] **Step 1: Write the failing type test** at `packages/iso/src/__tests__/define-loader-schema.test-d.ts`

```ts
import { expectTypeOf } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineLoader } from '../define-loader.js';
import { serverRoute } from '../server-route.js';

declare const searchSchema: StandardSchemaV1<
  { page: string },
  { page: number }
>;
declare const paramsSchema: StandardSchemaV1<{ id: string }, { id: number }>;

function _probes() {
  // searchSchema narrows ctx.location.searchParams; pathParams stays default.
  defineLoader(
    async (ctx) => {
      expectTypeOf(ctx.location.searchParams).toEqualTypeOf<{ page: number }>();
      expectTypeOf(ctx.location.pathParams).toEqualTypeOf<
        Record<string, string>
      >();
      return 1;
    },
    { searchSchema }
  );

  // No schema -> defaults are Record<string,string>.
  defineLoader(async (ctx) => {
    expectTypeOf(ctx.location.searchParams).toEqualTypeOf<
      Record<string, string>
    >();
    return 1;
  });

  // serverRoute route form: paramsSchema overrides RouteParams; default keeps it.
  const route = serverRoute('/task/:id');
  route.loader(
    async (ctx) => {
      expectTypeOf(ctx.location.pathParams).toEqualTypeOf<{ id: number }>();
      return 1;
    },
    { paramsSchema }
  );
  route.loader(async (ctx) => {
    // RouteParams<'/task/:id'> = { id: string }
    expectTypeOf(ctx.location.pathParams).toEqualTypeOf<{ id: string }>();
    return 1;
  });
}

void _probes;
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm vitest run --typecheck.only packages/iso/src/__tests__/define-loader-schema.test-d.ts`
Expected: FAIL (`searchSchema`/`paramsSchema` not in opts; ctx not narrowed).

- [ ] **Step 3: Edit `packages/iso/src/define-loader.ts`**

3a. Add the import:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';
```

3b. Widen `LoaderCtx` with a second type param `TSearch` (default `Record<string, string>`):

```ts
export type LoaderCtx<
  TParams = Record<string, string>,
  TSearch = Record<string, string>,
> = {
  c: Context;
  location: Omit<RouteHook, 'pathParams' | 'searchParams'> & {
    pathParams: TParams;
    searchParams: TSearch;
  };
  signal: AbortSignal;
};
```

3c. Widen `Loader` with the third param:

```ts
export type Loader<
  T,
  TParams = Record<string, string>,
  TSearch = Record<string, string>,
> =
  | ((ctx: LoaderCtx<TParams, TSearch>) => Promise<T>)
  | ((ctx: LoaderCtx<TParams, TSearch>) => Promise<ReadableStream<T>>)
  | ((ctx: LoaderCtx<TParams, TSearch>) => AsyncGenerator<T, void, unknown>);
```

3d. Add the schema-inference helper types (place them just above the `DefineLoaderOpts` declaration):

```ts
/** The two schema options a loader may carry. */
export type LoaderSchemaOpts = {
  paramsSchema?: StandardSchemaV1;
  searchSchema?: StandardSchemaV1;
};

/**
 * The pathParams type a loader's ctx sees, given its opts `O`: the
 * `paramsSchema` output if present, else `Fallback` (the bare-form default or
 * the route form's `RouteParams<RouteId>`).
 */
export type ParamsFromOpts<O, Fallback = Record<string, string>> = O extends {
  paramsSchema: infer P extends StandardSchemaV1;
}
  ? StandardSchemaV1.InferOutput<P>
  : Fallback;

/** The searchParams type a loader's ctx sees, given its opts `O`. */
export type SearchFromOpts<O> = O extends {
  searchSchema: infer S extends StandardSchemaV1;
}
  ? StandardSchemaV1.InferOutput<S>
  : Record<string, string>;
```

3e. Add `searchSchema` / `paramsSchema` to `DefineLoaderOpts<T>` (alongside the existing `params`, with a comment distinguishing them):

```ts
  /**
   * Standard Schema validating + coercing `ctx.location.searchParams`. NOTE:
   * distinct from `params` above (that is the cache-key dependency list). On
   * failure the loader RPC responds 400 and the error boundary catches it.
   */
  searchSchema?: StandardSchemaV1;
  /**
   * Standard Schema validating + coercing `ctx.location.pathParams`. On failure
   * the loader RPC responds 404. Non-live loaders only.
   */
  paramsSchema?: StandardSchemaV1;
```

3f. Add the schema fields to the `LoaderRef` interface (after `readonly params: string[] | '*';`):

```ts
  /** Search-params schema, as authored on `defineLoader({ searchSchema })`. */
  readonly searchSchema?: StandardSchemaV1;
  /** Path-params schema, as authored on `defineLoader({ paramsSchema })`. */
  readonly paramsSchema?: StandardSchemaV1;
```

3g. Replace the two NON-LIVE overload signatures (the 3rd and 4th overloads, currently `defineLoader<T>(fn, opts?)` and `defineLoader<RouteId, T>(route, fn, opts?)`) with schema-inferring versions. Keep the two `live: true` overloads (1st and 2nd) unchanged.

```ts
// Non-live bare form, with schema inference.
export function defineLoader<T, O extends LoaderSchemaOpts = {}>(
  fn: Loader<T, ParamsFromOpts<O>, SearchFromOpts<O>>,
  opts?: DefineLoaderOpts<T> & O
): LoaderRef<T, false>;
// Non-live route form, with schema inference (params default to RouteParams).
export function defineLoader<
  RouteId extends RegisteredPaths,
  T,
  O extends LoaderSchemaOpts = {},
>(
  route: RouteId,
  fn: Loader<T, ParamsFromOpts<O, RouteParams<RouteId>>, SearchFromOpts<O>>,
  opts?: DefineLoaderOpts<T> & O
): LoaderRef<T, false>;
```

3h. In the impl body, set the new fields on the `ref` object (after `params: opts?.params ?? [],`):

```ts
    searchSchema: opts?.searchSchema,
    paramsSchema: opts?.paramsSchema,
```

The impl signature (`fnOrRoute, fnOrOpts?, maybeOpts?`) and its `opts` extraction stay as-is; `DefineLoaderOpts<unknown>` already covers the new optional fields once they are added to the type.

- [ ] **Step 4: Forward the schemas through `serverRoute(id).loader`** (`packages/iso/src/server-route.ts`)

4a. Add the import:

```ts
import type {
  LoaderSchemaOpts,
  ParamsFromOpts,
  SearchFromOpts,
} from './define-loader.js';
```
(extend the existing `import { ... } from './define-loader.js';` type imports.)

4b. Change the `loader` method signature in the `RouteServer` interface to infer `O`:

```ts
  loader<T, O extends LoaderSchemaOpts = {}>(
    fn: Loader<
      T,
      ParamsFromOpts<O, RouteParams<RouteId>>,
      SearchFromOpts<O>
    >,
    opts?: Omit<DefineLoaderOpts<T>, 'live'> & O
  ): LoaderRef<T, false>;
```

4c. The impl `loader: (fn, opts) => defineLoader(route, fn, opts)` stays unchanged (it forwards opts, which now carry the schemas).

- [ ] **Step 5: Run the type test to confirm pass**

Run: `pnpm vitest run --typecheck.only packages/iso/src/__tests__/define-loader-schema.test-d.ts`
Expected: PASS.

- [ ] **Step 6: Write + run a runtime test** that the ref carries the schemas, at `packages/iso/src/__tests__/define-loader-schema.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineLoader } from '../define-loader.js';

const s: StandardSchemaV1<unknown, unknown> = {
  '~standard': { version: 1, vendor: 'test', validate: (v) => ({ value: v }) },
};

describe('defineLoader schema options', () => {
  it('stores searchSchema and paramsSchema on the ref', () => {
    const ref = defineLoader(async () => 1, {
      searchSchema: s,
      paramsSchema: s,
    });
    expect(ref.searchSchema).toBe(s);
    expect(ref.paramsSchema).toBe(s);
  });

  it('leaves them undefined when not provided', () => {
    const ref = defineLoader(async () => 1);
    expect(ref.searchSchema).toBeUndefined();
    expect(ref.paramsSchema).toBeUndefined();
  });
});
```

Run: `pnpm vitest run packages/iso/src/__tests__/define-loader-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Guard against regressions** - run the existing loader type + unit tests to confirm the `Loader`/`LoaderCtx` widening did not break callers:

Run: `pnpm vitest run packages/iso/src/__tests__/define-loader-live.test-d.ts packages/iso/src/__tests__/server-route.test-d.ts && pnpm vitest run packages/iso/src/__tests__/define-loader.test.ts packages/iso/src/__tests__/loader-params.test.ts`
Expected: PASS (defaults preserve `Record<string,string>` / `RouteParams`).

- [ ] **Step 8: Format, stage, commit**

```bash
pnpm format
git add packages/iso/src/define-loader.ts packages/iso/src/server-route.ts packages/iso/src/__tests__/define-loader-schema.test-d.ts packages/iso/src/__tests__/define-loader-schema.test.ts
git commit -m "feat(iso): defineLoader searchSchema/paramsSchema options + ctx narrowing"
```

---

## Task 7: Loader server enforcement (coercion + 400/404)

**Files:**
- Modify: `packages/server/src/loaders-handler.ts`
- Test: `packages/server/src/__tests__/loaders-handler.test.ts`

**Interfaces:**
- Consumes: `LoaderRef.searchSchema` / `LoaderRef.paramsSchema` (Task 6); `validateWithSchema` (runtime door); `deny` (iso).
- Produces: `LoaderEntry.searchSchema?` / `LoaderEntry.paramsSchema?`; enforcement that throws `deny(400)` (search) / `deny(404)` (params) and passes coerced values into the loader.

- [ ] **Step 1: Write the failing tests** - add to `packages/server/src/__tests__/loaders-handler.test.ts`. Mirror that file's existing app-build harness (it constructs `loadersHandler(glob, { resolvePageUse: async () => [] })` and POSTs to `/__loaders`). Add a fixture loader carrying schemas and these cases:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

const numericId: StandardSchemaV1<{ id: string }, { id: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      const id = Number((v as { id: unknown }).id);
      return Number.isInteger(id)
        ? { value: { id } }
        : { issues: [{ message: 'id must be an integer', path: ['id'] }] };
    },
  },
};
const minPage: StandardSchemaV1<{ page: string }, { page: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (v) => {
      const page = Number((v as { page: unknown }).page);
      return page >= 1
        ? { value: { page } }
        : { issues: [{ message: 'page must be >= 1', path: ['page'] }] };
    },
  },
};
```

Build a glob whose module exports `serverLoaders` with refs carrying schemas. The cleanest is to construct `defineLoader` refs directly (import `defineLoader` from `@hono-preact/iso`) and put them under a `__moduleKey`:

```ts
import { defineLoader } from '@hono-preact/iso';

function globWith(loader: unknown) {
  return {
    './x.server.ts': {
      __moduleKey: 'pages/x.server',
      serverLoaders: { default: loader },
    },
  };
}
```

Cases:

```ts
it('coerces searchParams via searchSchema and passes them to the loader', async () => {
  let seen: unknown;
  const ref = defineLoader(
    async (ctx) => {
      seen = ctx.location.searchParams;
      return 'ok';
    },
    { searchSchema: minPage }
  );
  const handler = loadersHandler(globWith(ref), { resolvePageUse: async () => [] });
  const app = new Hono().post('*', handler);
  const res = await app.request('/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: 'pages/x.server',
      loader: 'default',
      location: { path: '/x', pathParams: {}, searchParams: { page: '3' } },
    }),
  });
  expect(res.status).toBe(200);
  expect(seen).toEqual({ page: 3 });
});

it('returns 400 when searchSchema fails', async () => {
  const ref = defineLoader(async () => 'ok', { searchSchema: minPage });
  const handler = loadersHandler(globWith(ref), { resolvePageUse: async () => [] });
  const app = new Hono().post('*', handler);
  const res = await app.request('/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: 'pages/x.server',
      loader: 'default',
      location: { path: '/x', pathParams: {}, searchParams: { page: '0' } },
    }),
  });
  expect(res.status).toBe(400);
});

it('returns 404 when paramsSchema fails', async () => {
  const ref = defineLoader(async () => 'ok', { paramsSchema: numericId });
  const handler = loadersHandler(globWith(ref), { resolvePageUse: async () => [] });
  const app = new Hono().post('*', handler);
  const res = await app.request('/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: 'pages/x.server',
      loader: 'default',
      location: { path: '/x/abc', pathParams: { id: 'abc' }, searchParams: {} },
    }),
  });
  expect(res.status).toBe(404);
});
```

Run: `pnpm vitest run packages/server/src/__tests__/loaders-handler.test.ts`
Expected: FAIL (no enforcement; searchParams arrive uncoerced as `{ page: '3' }`).

- [ ] **Step 2: Edit `packages/server/src/loaders-handler.ts`**

2a. Add imports:

```ts
import { isOutcome, timeoutOutcome, deny, type AppConfig, type ServerLoaderCtx } from '@hono-preact/iso';
```
(add `deny` to the existing iso import line.)
```ts
import { runRequestScope, dispatchServer, validateWithSchema } from '@hono-preact/iso/internal';
```
NOTE: `validateWithSchema` is exported from `@hono-preact/iso/internal/runtime`. The loaders handler already imports runtime constants elsewhere; import `validateWithSchema` from `@hono-preact/iso/internal/runtime` specifically:
```ts
import { validateWithSchema } from '@hono-preact/iso/internal/runtime';
```
(keep `runRequestScope, dispatchServer` on their existing `@hono-preact/iso/internal` import.)

2b. Widen the internal `LoaderFn` location type so coerced (non-string) values type-check at the call site without a cast (reshape, not cast). Use `unknown` for the param records: the schema output type is intentionally not known at the handler (the public `Loader<T, TParams, TSearch>` generic carries it to the user's loader), and `unknown` accepts both the raw string records and the coerced values with zero casts:

```ts
type LoaderFn = (props: {
  c: Context;
  location: {
    path: string;
    pathParams: unknown;
    searchParams: unknown;
  };
  signal: AbortSignal;
}) => Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;
```

2c. Add schema fields to `LoaderEntry`:

```ts
type LoaderEntry = {
  fn: LoaderFn;
  use: ReadonlyArray<unknown>;
  timeoutMs?: number | false;
  searchSchema?: import('@hono-preact/iso').StandardSchemaV1;
  paramsSchema?: import('@hono-preact/iso').StandardSchemaV1;
};
```
(or add `StandardSchemaV1` to the top-level iso type import and reference it directly.)

2d. In `buildLoadersMap`, read the schemas off the ref in the `LoaderRef` branch:

```ts
        } else if (val && typeof (val as { fn?: unknown }).fn === 'function') {
          const ref = val as {
            fn: LoaderFn;
            use?: ReadonlyArray<unknown>;
            timeoutMs?: number | false;
            searchSchema?: import('@hono-preact/iso').StandardSchemaV1;
            paramsSchema?: import('@hono-preact/iso').StandardSchemaV1;
          };
          result[`${moduleKey}::${name}`] = {
            fn: ref.fn,
            use: ref.use ?? [],
            timeoutMs: ref.timeoutMs,
            searchSchema: ref.searchSchema,
            paramsSchema: ref.paramsSchema,
          };
        }
```

2e. Enforce inside the `inner` thunk. The current inner is:

```ts
            inner: async () => {
              const inner = await entry.fn({ c, location: validatedLocation, signal });
              if (isOutcome(inner)) throw inner;
              return inner;
            },
```

Replace with validation + coercion (params -> 404, search -> 400), forwarding the coerced values. Because `LoaderFn.location` params are now `unknown` (Step 2b), the coerced `r.value` (typed `unknown`) is assigned with no cast:

```ts
            inner: async () => {
              let pathParams: unknown = validatedLocation.pathParams;
              let searchParams: unknown = validatedLocation.searchParams;
              if (entry.paramsSchema) {
                const r = await validateWithSchema(
                  entry.paramsSchema,
                  validatedLocation.pathParams
                );
                // Bad route param: the URL does not name a valid resource.
                if (!r.ok) throw deny(404, 'Invalid route parameters');
                pathParams = r.value;
              }
              if (entry.searchSchema) {
                const r = await validateWithSchema(
                  entry.searchSchema,
                  validatedLocation.searchParams
                );
                // Bad query string.
                if (!r.ok) throw deny(400, 'Invalid search parameters');
                searchParams = r.value;
              }
              const inner = await entry.fn({
                c,
                location: { path: validatedLocation.path, pathParams, searchParams },
                signal,
              });
              if (isOutcome(inner)) throw inner;
              return inner;
            },
```

No casts: `validateWithSchema` returns `value: unknown`, and `LoaderFn.location.pathParams`/`searchParams` are `unknown`, so the assignment is direct. Do NOT thread the schema generic into the handler.

2f. The `ServerLoaderCtx` `location` (middleware ctx) keeps `validatedLocation` (the raw string records), unchanged: middleware runs before validation and sees the raw params, consistent with the action path. Only `entry.fn` receives the coerced `effective` location.

- [ ] **Step 3: Run loader handler tests to confirm pass**

Run: `pnpm vitest run packages/server/src/__tests__/loaders-handler.test.ts`
Expected: PASS (coercion observable, 400 on bad search, 404 on bad params).

- [ ] **Step 4: Regression-check the broader loader/server suites**

Run: `pnpm vitest run packages/server/src/__tests__/loaders-handler-multi.test.ts packages/server/src/__tests__/loaders-handler-timeout.test.ts`
Expected: PASS (no schema -> unchanged path).

- [ ] **Step 5: Format, stage, commit**

```bash
pnpm format
git add packages/server/src/loaders-handler.ts packages/server/src/__tests__/loaders-handler.test.ts
git commit -m "feat(server): enforce loader searchSchema/paramsSchema (400/404 + coercion)"
```

---

## Task 8: End-to-end integration test with a real validator (Zod)

**Files:**
- Modify: root `package.json` (add `zod` to `devDependencies`)
- Create: `packages/server/src/__tests__/standard-schema.integration.test.ts`

**Interfaces:**
- Consumes: the full action + loader stack; `zod` (devDependency).
- Produces: proof that a real Standard Schema flows through action validation (deny 422 + coercion) and loader validation (400/404 + coercion).

- [ ] **Step 1: Confirm the integration glob** - read `vitest.integration.config.ts` to learn the include pattern (the existing `pe-form-no-js.integration.test.ts` lives under `packages/server/src/__tests__/`). Place the new file to match that pattern.

- [ ] **Step 2: Add Zod as a devDependency**

```bash
pnpm add -D -w zod
```
Verify it landed in root `package.json` `devDependencies` (NOT in any package's runtime deps). Confirm Zod ships Standard Schema support (`schema['~standard']` is present on a `z.object(...)`).

- [ ] **Step 3: Write the integration test** at `packages/server/src/__tests__/standard-schema.integration.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { h } from 'preact';
import { z } from 'zod';
import { pageActionHandler } from '../page-action-handler.js';
import { loadersHandler } from '../loaders-handler.js';
import { defineAction, defineLoader } from '@hono-preact/iso';
import { VALIDATION_ISSUES_KEY } from '@hono-preact/iso/internal/runtime';

const NewTask = z.object({
  title: z.string().min(1),
  count: z.coerce.number().int(),
});

describe('Standard Schema end-to-end (Zod)', () => {
  it('rejects an invalid action payload with deny(422) + issues, coerces a valid one', async () => {
    const fn = vi.fn(async (_ctx: unknown, payload: { title: string; count: number }) => ({
      ok: payload.count,
    }));
    const create = defineAction(fn, { input: NewTask });
    const resolverByPath = async () =>
      new Map([
        ['create', { fn: create as never, use: [], moduleKey: 'pages/t.server', input: NewTask }],
      ]);
    const handler = pageActionHandler({
      resolverByPath,
      resolvePageUseByPath: async () => [],
      renderPage: (async (c: { html: (s: string) => unknown }) =>
        c.html('<!doctype html>X')) as never,
      resolvePageNode: () => h('div', null),
      appConfig: { use: [] },
    });
    const app = new Hono().post('*', handler);

    // invalid: empty title + non-numeric count
    const bad = await app.request('/t', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module: 'pages/t.server', action: 'create', payload: { title: '', count: 'x' } }),
    });
    expect(bad.status).toBe(422);
    const badBody = await bad.json();
    expect(Array.isArray(badBody.data[VALIDATION_ISSUES_KEY])).toBe(true);
    expect(fn).not.toHaveBeenCalled();

    // valid: count coerced from string to number
    const good = await app.request('/t', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ module: 'pages/t.server', action: 'create', payload: { title: 'Hi', count: '5' } }),
    });
    expect(good.status).toBe(200);
    expect(fn).toHaveBeenCalledWith(expect.anything(), { title: 'Hi', count: 5 });
  });

  it('coerces loader search params and 400s on invalid', async () => {
    const ref = defineLoader(
      async (ctx) => ctx.location.searchParams,
      { searchSchema: z.object({ page: z.coerce.number().min(1) }) }
    );
    const glob = { './t.server.ts': { __moduleKey: 'pages/t.server', serverLoaders: { default: ref } } };
    const handler = loadersHandler(glob, { resolvePageUse: async () => [] });
    const app = new Hono().post('*', handler);

    const ok = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'pages/t.server', loader: 'default', location: { path: '/t', pathParams: {}, searchParams: { page: '2' } } }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ page: 2 });

    const bad = await app.request('/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: 'pages/t.server', loader: 'default', location: { path: '/t', pathParams: {}, searchParams: { page: '0' } } }),
    });
    expect(bad.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run the integration suite**

Run: `pnpm test:integration`
Expected: PASS (both cases). If the config's include glob excludes this path, move the file to match (Step 1).

- [ ] **Step 5: Format, stage, commit**

```bash
pnpm format
git add package.json pnpm-lock.yaml packages/server/src/__tests__/standard-schema.integration.test.ts
git commit -m "test: end-to-end Standard Schema validation with Zod (devDep)"
```

---

## Task 9: Docs, LLM corpus, drift gates, dogfood demo

**Files:**
- Read first: `.claude/skills/add-docs-page.md` (local skill, REQUIRED before adding the page).
- Create: a guide docs page under `apps/site/src/` (path per the add-docs-page skill), e.g. `apps/site/src/pages/docs/guide/validation.mdx` + its nav registration.
- Modify: the LLM corpus generation + `AGENTS.md` template inputs so the new public API is covered (whatever the `exports-coverage` and `appendix-sync` gates require).
- Modify: `apps/site` demo (the `/demo` task board create-task action) to dogfood `input` + `<Form schema>` + `<FieldError>`.

**Interfaces:**
- Consumes: all public API from Tasks 1-7 (`defineAction({ input })`, `defineLoader({ searchSchema, paramsSchema })`, `<Form schema>`, `getValidationIssues`, `useFieldErrors`, `<FieldError>`).

- [ ] **Step 1: Read the local docs skill** - read `.claude/skills/add-docs-page.md` and follow it exactly for page placement, frontmatter, and nav wiring.

- [ ] **Step 2: Write the guide page.** Cover: authoring a shared schema; `defineAction({ input })` with handler-side coercion; the server-authoritative + opt-in-client model; `<Form schema>` + `<FieldError>` + `useFieldErrors`; `getValidationIssues` for custom rendering; loader `searchSchema`/`paramsSchema` with the 400/404 + error-boundary semantics; the "schema for a `<Form>` must live in a shared (non-`.server`) module" rule; the "no framework coercion, the schema coerces" rule. Use live `<Example>` demos consistent with the existing component/guide pages. Do NOT add migration/"previously" breadcrumbs (project convention).

- [ ] **Step 3: Dogfood on `/demo`.** Locate the demo task board's create-task action (`apps/site/src/.../*.server.*` + the form component). Add a shared schema module, wire it as the action `input`, pass it to the `<Form schema>`, and render `<FieldError>` for the title field. Verify the demo still builds.

- [ ] **Step 4: Run the drift gates and fix what they flag.**

```bash
pnpm --filter site build
```
Then run the repo's drift gates (exports-coverage and appendix-sync). Find them via:
```bash
rg -l "exports-coverage|appendix-sync|llms" scripts package.json apps/site
```
Run each gate's command (they are wired into CI / package scripts). Update the LLM corpus allowlist / `AGENTS.md` appendix inputs until both gates pass. The new public exports that must be covered: `getValidationIssues`, `useFieldErrors`, `FieldError`, `StandardSchemaV1`, `ValidationIssue`, `InferSchemaInput`, `InferSchemaOutput`, and the new options (`input`, `searchSchema`, `paramsSchema`, Form `schema`).

- [ ] **Step 5: Format, stage, commit**

```bash
pnpm format
git add -A
git commit -m "docs: validation guide page, demo dogfood, LLM corpus + drift gates"
```

---

## Task 10: Full pre-push verification

**Files:** none (verification only).

- [ ] **Step 1: Run the seven CI steps in order** (from CLAUDE.md "Pre-push verification"):

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```
Expected: all pass. If `format:check` fails, run `pnpm format`, re-stage, amend/commit, and re-run.

- [ ] **Step 2: Confirm no stray client bundle bloat.** The client size baseline comment should not show `@standard-schema/spec` or Zod in the client buckets (the spec package is types-only; Zod is a devDependency). If a size baseline file changed, review the diff and update it per the existing size-tracking flow only if the change is legitimate (the validation core is small and tree-shakeable; `<Form>` gains a few hundred bytes).

- [ ] **Step 3: Self-review the diff** against the spec's six sections and the "Out of scope" list. Confirm: no Zod/Valibot import in framework `src`; `deny.data` reserved-key contract intact; loader middleware/auth still composes before validation (validation is in the innermost thunk); `useParams` still returns strings.

- [ ] **Step 4: Finish the branch.** Use superpowers:finishing-a-development-branch to choose merge/PR. Per the PR workflow in CLAUDE.md, opening a PR triggers an immediate deep PR review (replacement parity + cross-cutting concerns, especially that no auth/permission middleware was dropped on the action or loader paths).

---

## Self-Review (planner)

- **Spec coverage:** Section 1 -> Task 1. Section 2 (actions) -> Tasks 2-4. Section 3 (Form) -> Task 5. Section 4 (loaders) -> Tasks 6-7. Section 5 (build gate / wire / surface / docs) -> Tasks 1,4,5,6,9 (no build-gate change needed; wire key in Task 1; public surface across 4/5/6; docs in 9). Section 6 (testing) -> every task is TDD + Task 8 integration. Out-of-scope items are not implemented.
- **Type consistency:** `VALIDATION_ISSUES_KEY`, `ValidationIssue`, `validateWithSchema`, `mapIssuesToFields`, `getValidationIssues`, `FieldErrorsMap`, `LoaderSchemaOpts`, `ParamsFromOpts`, `SearchFromOpts`, `searchSchema`/`paramsSchema` are used with the same names across tasks. `InferOutput` is the carried payload type throughout.
- **Risk notes:** the two hardest type seams (action `input` inference, loader schema inference) were verified by standalone `tsc` spikes before this plan; the `*.test-d.ts` tasks pin them permanently. The loader handler's two `as Record<string, unknown>` are the documented handler-seam reshape boundary (schema output type is intentionally not threaded into the handler).
