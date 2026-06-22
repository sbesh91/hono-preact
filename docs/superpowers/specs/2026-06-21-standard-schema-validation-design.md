# Standard Schema payload validation

Design doc. Status: approved, pending implementation plan.

## Goal

Add first-class, library-agnostic payload validation to the framework using the
[Standard Schema](https://standardschema.dev) spec. Users bring their own
validator (Zod, Valibot, ArkType, anything implementing `~standard`); the
framework depends only on the types-only `@standard-schema/spec` package and
never on a specific library.

Validation covers four payload surfaces:

1. **Action payloads** (JSON / FormData reaching `defineAction` handlers).
2. **Form fields** (the same action schema run client-side before submit).
3. **Loader search params** (`ctx.location.searchParams`).
4. **Loader route params** (`ctx.location.pathParams`).

## Decisions (locked during brainstorming)

- **Server is authoritative; client validation is opt-in.** The server always
  validates at the handler seam (the security boundary). Client-side validation
  is an opt-in enhancement that only works when the schema lives in a module the
  browser can import. This is the honest model given that `.server.*` files are
  stripped to typed proxies on the client.
- **Library-agnostic.** Framework runtime dependency is `@standard-schema/spec`
  (types only). A concrete validator appears only as a test devDependency.
- **Schema as a sibling option.** Schemas attach through the existing options
  object (`{ use, timeoutMs }` style), not via wrapper functions or new module
  exports: `defineAction(fn, { input })`,
  `defineLoader(fn, { searchSchema, paramsSchema })`,
  `serverRoute(id).loader(fn, { paramsSchema })`, `<Form schema>`. The loader
  options are `searchSchema`/`paramsSchema` (not `search`/`params`) because
  `DefineLoaderOpts` already has a `params` option (the cache-key dependency
  list, `string[] | '*'`); the explicit `Schema` suffix avoids that collision.
- **No framework coercion.** Standard Schema validates `Input -> Output` and
  does not coerce. The framework passes the raw payload as `Input`. Coercing
  FormData strings (`z.coerce.number()` and friends) is the schema author's job.
- **Client-facing payload type is `InferOutput`, uniformly.** The whole
  client-facing stub is keyed on a single `TPayload` type param (it flows through
  `useAction`, `<Form>`, `useActionResult`, `MutateResult`, optimistic-action).
  That single param is `InferOutput<typeof input>` for `mutate`, `<Form>`, and
  the handler alike. Using `InferInput` for `mutate` would conflict with the
  same-schema `<Form schema>` drift-safety typing (a coercion schema's output is
  `InferOutput`); for no-coercion schemas the two are identical, so this only
  differs for coercion schemas, where carrying the clean type is the better DX.
  The server still validates `Input -> Output` at runtime, so a `<Form>` POSTing
  raw FormData strings and a `mutate({ count: 3 })` sending the clean shape both
  pass; the types describe the post-validation shape.
- **Validation failures reuse the `deny` outcome.** No new envelope tag. Schema
  failure produces `deny(422, message, { data: { [VALIDATION_ISSUES_KEY]: issues } })`.
  A reserved, framework-owned key keeps "validation deny" distinguishable from an
  app-level deny in practice (a contract carried inside `deny`).
- **Loader failures throw to the error boundary.** Bad search params throw 400;
  bad route params throw 404. Both surface through the existing loader error UI.
- **Form UX: submit-gate + live-clear after first error.** Validate on submit
  and block the POST if invalid; once a field has shown an error, re-validate
  that field on input so its error clears as the user fixes it. Untouched fields
  stay quiet until submit.

## Rejected alternatives

- **Wrapper functions** (`validatedAction(schema, fn)`): creates a parallel API
  beside `defineAction` and composes awkwardly with existing options.
- **Build-time schema extraction** (vite plugin lifting `input` schemas into
  client chunks for automatic, no-prop pre-validation): "isomorphic by default"
  fights the `.server` stripping model and bloats the client bundle.
- **Dedicated `invalid` (422) outcome tag**: cleaner in theory but a larger wire
  change; we accepted the `deny` reuse with a reserved key instead.

## Architecture

Ownership follows the existing seams in the codebase:

- `packages/iso` owns the validation core, the define-time types, and the
  isomorphic helpers.
- `packages/server` owns enforcement (the two handler seams).
- `packages/vite` is untouched (see "Build gate" below).

### Section 1 - The validation core (iso)

New module `packages/iso/src/validate.ts`.

- **Dependency**: add `@standard-schema/spec` (types only) to `@hono-preact/iso`.
- **`validateWithSchema(schema, input)`**: calls `schema['~standard'].validate(input)`,
  `await`s if it returns a Promise, returns a discriminated result
  `{ ok: true, value } | { ok: false, issues }`. Async-capable because every
  enforcement seam (handlers, form submit, loaders) is already async.
- **Issue normalization**: Standard Schema issues carry `message` and an optional
  `path` of `PropertyKey | { key: PropertyKey }` segments. Normalize each to
  `{ path: (string | number)[]; message: string }`, the field-error shape that
  `<Form>` and `useActionResult` consume.
- **Reserved key**: `VALIDATION_ISSUES_KEY` constant in `internal/contract.ts`,
  so reading issues out of `deny.data` is a typed contract, not shape-sniffing.
- **Type helpers**: re-export `StandardSchemaV1` and alias
  `StandardSchemaV1.InferInput` / `InferOutput` as the framework's single
  inference reference point.

`validateWithSchema` and `VALIDATION_ISSUES_KEY` are internal
(`/internal/runtime`); they are framework plumbing, not app API.

### Section 2 - Actions: enforcement + type inference

**Define-time.** `DefineActionOpts` gains optional `input?: StandardSchemaV1`. A
new `defineAction` overload: when `input` is present, the handler's `payload` is
inferred as `InferOutput<typeof input>`, and the client-facing `ActionStub`'s
`TPayload` is the same `InferOutput<typeof input>`.

```ts
const NewTask = z.object({ title: z.string().min(1), count: z.coerce.number() })

export const create = defineAction(
  (ctx, payload) => {
    // payload: { title: string; count: number }
  },
  { input: NewTask },
)
```

**Server enforcement.** The schema is attached as non-enumerable metadata in
`defineAction` (alongside `use`/`timeoutMs`), read by `extractActions` into
`ActionEntry`, and enforced in `pageActionHandler` in the innermost call (after
middleware/auth, before `fn`):

- On success the handler is called with the validated output (coercion is
  observable to the handler).
- On failure the inner thunk throws
  `deny(422, message, { data: { [VALIDATION_ISSUES_KEY]: issues } })` and `fn`
  never runs. The existing outcome path serializes it (JSON envelope) or
  re-renders the page with the deny slot (no-JS), exactly as a handler-authored
  deny does today.

**Reading issues client-side.** A typed helper `getValidationIssues(result)`
pulls issues out of `useActionResult()` via the reserved key, returning the
normalized `{ path, message }[]` (or `null` for non-validation denies). This is
the contract that keeps validation denies distinguishable from app-level denies
despite sharing the `deny` tag.

### Section 3 - Form: client-side pre-validation

`<Form>` gains an optional `schema` prop for opt-in client pre-validation.
Because `.server.*` modules are stripped to proxies, the schema must be authored
in a shared (non-`.server`) module and referenced in both the action's `input`
and the Form's `schema`; the shared import links them.

**Drift safety via types.** The `schema` prop is typed as
`StandardSchemaV1<unknown, TPayload>` where `TPayload` is the action's inferred
payload type (`InferOutput<input>`, carried by the typed stub). Passing a schema
that produces the wrong shape is a compile error, so the two cannot drift even
though the runtime schema is not auto-shared.

**Behavior (submit-gate + live-clear after first error):**

1. On submit, `collectFormData` builds the payload record (unchanged), then
   `validateWithSchema(schema, record)` runs before the POST.
2. If issues: `preventDefault`, block the POST, normalize issues, store them in
   Form-local field-error state keyed by issue `path` (joined with `.`, so
   `['title'] -> "title"`). Nothing is sent to the server.
3. Once a field has shown an error, an `onInput` on the form re-validates on
   input to that field (re-runs the full schema, recomputes that field's issues)
   so its error clears as the user fixes it. Fields that never errored stay quiet
   until the next submit.
4. If valid: submit proceeds exactly as today. The server still re-validates
   authoritatively, and a server `deny(422)` flows back through `useActionResult`
   into the same field-error surface, so client-skipped and server-caught errors
   render identically.

**Rendering issues.** A consumer-facing `useFieldErrors()` hook is the primitive:
it reads Form context and unifies client pre-validation issues and
server-returned issues into one `Record<fieldName, message[]>`. A
`<FieldError name>` component ships as a thin convenience wrapper over the hook
(renders that field's first message, or nothing). No-JS pages get the server path
automatically; this enhances the JS path.

### Section 4 - Loaders: search + route params

`DefineLoaderOpts` gains optional `searchSchema?: StandardSchemaV1` and
`paramsSchema?: StandardSchemaV1`. When present they validate and coerce
`ctx.location.searchParams` / `ctx.location.pathParams`, and the loader's
`ctx.location` types narrow from the all-`string` defaults to the schema outputs.
Scoped to non-live loaders for v1 (live loaders keep string params).

```ts
defineLoader(
  (ctx) => {
    // ctx.location.searchParams: { page: number }
  },
  { searchSchema: z.object({ page: z.coerce.number().min(1).default(1) }) },
)

serverRoute('/task/:id').loader(
  (ctx) => {
    // ctx.location.pathParams: { id: number }
  },
  { paramsSchema: z.object({ id: z.coerce.number().int() }) },
)
```

**Type integration (verified by spike).** `LoaderCtx` gains a second type param
`TSearch` (defaulting to `Record<string, string>`) so
`ctx.location.searchParams` can narrow. A single non-live overload
`defineLoader<T, O extends LoaderSchemaOpts = {}>(fn, opts?)` infers `O` from the
`opts` object (a non-context-sensitive literal, inferred before the
context-sensitive `fn` arg is contextually typed) and maps it to the loader's
`ctx` via `ParamsFromOpts<O>` / `SearchFromOpts<O>` (conditional types that read
`paramsSchema`/`searchSchema` and apply `InferOutput`, falling back to
`Record<string, string>` / `RouteParams<RouteId>`). `serverRoute(id).loader`
forwards the same `O`. A throwaway `tsc` spike confirmed this formulation flows
the schema output into `ctx`, defaults correctly with no schema, and rejects a
mismatched assignment; a `*.test-d.ts` pins it as the permanent gate.

**Server enforcement** in `loadersHandler`, after `validateLocation(loc)` and
before `entry.fn(...)`:

- `searchSchema` failure -> throw `deny(400, ...)` (bad query string).
- `paramsSchema` failure -> throw `deny(404, ...)` (the URL does not name a valid
  resource).
- Both are caught by the handler's existing `isOutcome(err)` path and translated
  by `translateOutcomeForLoader` into a `deny` JSON response at that status; the
  client `loaderHttpError` turns the non-ok response into a thrown `Error` the
  loader error boundary catches. On success the loader runs with the coerced
  values in `ctx.location`.

**Internal type reshape.** The server-internal `LoaderFn` location type widens
`pathParams`/`searchParams` to carry post-coercion values (the schema output type
is not known at the handler; the public `Loader<T, TParams, TSearch>` generic
carries it to the user's loader). No cast at the call site.

**Scope boundary.** Loaders run server-side (and during SSR); there is no client
pre-validation surface for loaders, the URL is the input and the server is the
only authority. `useParams()` client-side still returns the raw string params
from the route match; the coerced types are a loader-side concern. Document this.

### Section 5 - Build gate, wire contract, public surface, docs

**No build-gate change needed.** Because schemas are passed inline as options
rather than as new exports, the `serverLoaderValidationPlugin` allowlist
(`serverActions` / `serverLoaders` only) is untouched. Two authoring rules fall
out and get documented:

- A schema used only server-side can be a local `const` inside the `.server.*`
  file (not a named export, so the allowlist is happy).
- A schema shared with a `<Form>` must live in a shared (non-`.server`) module,
  since `.server.*` is stripped from the client.

**Wire contract.** Add `VALIDATION_ISSUES_KEY` to `internal/contract.ts`. Issues
are plain `{ path, message }[]`, so they pass through `Serialize<T>` and the
existing envelope codec (`serializeActionOutcome` / `decodeActionResponse`) with
no codec changes; `deny.data` is already serialized and decoded on the wire.

**Public surface** (exported from the iso barrel, re-exported by the umbrella):

- Options: `input` on `DefineActionOpts`; `searchSchema` / `paramsSchema` on
  `DefineLoaderOpts`; `schema` on `Form`.
- Helpers: `getValidationIssues(result)`, `useFieldErrors()`, and the
  `<FieldError name>` convenience wrapper.
- Types: `StandardSchemaV1` and the `InferInput` / `InferOutput` aliases;
  `ValidationIssue`.
- Internal (`/internal/runtime`): `validateWithSchema`, `VALIDATION_ISSUES_KEY`.

**Docs / LLM gates.** Net-new public API trips the exports-coverage and
appendix-sync drift gates. Add a guide docs page (follow the local
`add-docs-page` skill), update `AGENTS.md` / `llms.txt` generation, and add a
site demo (the `/demo` task board's create-task action is a natural dogfood
target for `input` + `<Form schema>`).

### Section 6 - Testing

- **Unit (`validateWithSchema` + normalization)**: sync and async schemas;
  success returns `{ ok: true, value }`; failure returns normalized issues
  including nested paths (`['address', 'zip']`) and array indices. Use a small
  hand-rolled `StandardSchemaV1` object so the adapter is tested against the raw
  spec, not one vendor's quirks.
- **Action enforcement**: schema rejects -> `fn` never runs, result is
  `deny(422)` with issues under the reserved key; schema accepts + coerces ->
  `fn` receives the coerced output. Run the consuming suites
  (`pnpm test:coverage`), since server behavior is consumed by iso.
- **Form client pre-validation**: submit-gate blocks the POST on issues;
  live-clear re-validates an errored field on input; valid submit proceeds and a
  server `deny(422)` renders through the same field-error surface. Preact tests
  need `act()`-flushed raw events.
- **Loader enforcement**: bad search -> thrown 400; bad route param -> thrown
  404; both reach the error boundary; coerced values observable in
  `ctx.location`.
- **Type-level (`*.test-d.ts` via `pnpm test:types`)**: payload inferred from
  `input`; `<Form schema>` rejecting a drift-mismatched schema; loader
  `searchSchema` / `paramsSchema` narrowing `ctx.location`.
- **Realism dep**: add one real validator (Zod or Valibot) as a devDependency
  only, for an end-to-end integration test (`pnpm test:integration`) proving a
  real schema flows through actions / forms / loaders. Framework runtime deps
  stay agnostic (`@standard-schema/spec` types only).

## Out of scope

- Automatic client bundling of server schemas (the rejected build-time
  extraction path).
- Client pre-validation for loaders.
- Framework-level coercion of FormData values.
- A dedicated `invalid` outcome tag.
