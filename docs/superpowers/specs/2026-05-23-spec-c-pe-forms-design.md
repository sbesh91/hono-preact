# Spec C — Progressive-enhancement forms + `/__actions` envelope reshape

Part of the [web-standards adoption roadmap](./2026-05-23-web-standards-adoption-roadmap.md). Independently shippable on `main`; bundled with B/D/E into the eventual `v0.3.0` cut.

## Goal

Make `<Form>` submissions work without client JavaScript, and reshape the actions wire to remove the inconsistencies that block that.

Today, `<Form>` calls `e.preventDefault()` unconditionally and posts JSON to `/__actions` via `useAction`. The form element has no `action` or `method` attribute. With JS off, a submit does nothing.

After this spec, the same form HTML submits to the page's own URL as a native `multipart/form-data` POST. The page route handles GET (render) and POST (run action, then redirect, re-render with errors, or stream). With JS on, the framework intercepts the submit and uses the same URL with `Accept: application/json` to get the result back without a full page round-trip. One endpoint, content-negotiated.

## Non-goals

- E2E browser tests with JS disabled (recommended as a follow-up, not blocking).
- A codemod for the API rename (the change is mechanical; manual is fine).
- CSRF middleware reach (still tracked separately in issue #43).
- Streaming actions on the PE path. They remain JS-only; `<Form action={streamingStub}>` is a type error.

## Wire shape

### URL

Actions are invoked at the page's own URL via POST. The global `/__actions` endpoint is removed. The same page route handles both GET (render the page) and POST (run an action then respond).

Which action: the request body carries `__module` and `__action` fields (form fields or JSON body keys). Both are always required; no implicit defaulting for single-action pages.

A page's POST handler registry includes actions from the page module *and* from every layout in the page's chain. This means `<Form action={layoutAction}>` mounted inside a child page works: the child page's POST handler can resolve and run a layout-owned action. The `routeServerModules` adapter already knows the page-to-layout chain; the plan extends it to flatten action registries across the chain.

### Content negotiation

The page POST handler reads the `Accept` header:

| `Accept` contains | Response |
|---|---|
| `text/html` (or absent) | PE path: real 303 / HTML re-render / 500 HTML page |
| `application/json` | JSON envelope (see below) |
| `text/event-stream` | SSE stream (streaming actions only) |

### Uniform JSON envelope

Today's envelope is inconsistent: success is bare JSON, redirect/deny/timeout are `__outcome`-wrapped, redirect ships with HTTP 200, error uses `{error: ...}`. The new envelope is uniformly `__outcome`-tagged:

| Outcome | Envelope | HTTP |
|---|---|---|
| Success | `{__outcome: 'success', data: TResult}` | 200 |
| Redirect | `{__outcome: 'redirect', to, status}` | 200 (client follows; we can't ship a real 30x to a fetch caller without surprising it) |
| Deny | `{__outcome: 'deny', status, message, data?}` | `status` (e.g. 422) |
| Timeout | `{__outcome: 'timeout', timeoutMs}` | 504 |
| Error | `{__outcome: 'error', message}` | 500 |

The client's `useAction` reads `__outcome` first then dispatches. The current redirect-peek-via-`response.clone().json()` hack in `packages/iso/src/action.ts` goes away.

### Body parsing

Same as today: `multipart/form-data` and `application/x-www-form-urlencoded` decode to a payload object (repeated keys collect into arrays); `application/json` parses the body's `payload` field. The form-data path is what the no-JS browser submit produces; the JSON path is what `useAction` produces.

### PE response rules (HTML path)

| Action outcome | HTTP response |
|---|---|
| Returns data | 303 to current URL. Loaders re-run. The returned `data` is discarded on the PE path. Devs who want it on screen put it in a loader. |
| Throws `redirect(to)` | Real 303 (or `status`) to `to` |
| Throws `deny(status, message, { data? })` | `status` HTTP code. Full HTML re-render of the same page with deny outcome AND the parsed submitted payload injected into render context (readable via `useActionResult()`; the payload powers `defaultValue` re-population so inputs survive validation failures) |
| Throws other error | 500 HTML page (dev: with message; prod: generic) |
| Returns a `ReadableStream` or async generator | 405 Method Not Allowed with a body explaining streaming requires `Accept: text/event-stream` |

## Client API

### `<Form action={stub}>`

The only form component. The existing `<Form mutate={...} pending={...}>` API is removed (hard cutover).

```ts
type FormProps<TPayload, TResult> = Omit<
  JSX.HTMLAttributes<HTMLFormElement>,
  'action' | 'method' | 'onSubmit'
> & {
  action: ActionStub<TPayload, TResult, never>;  // TChunk = never: streaming stubs rejected
  children?: ComponentChildren;
};
```

Renders:

```html
<form method="post" enctype="multipart/form-data">
  <input type="hidden" name="__module" value="...">
  <input type="hidden" name="__action" value="...">
  <fieldset disabled={pending} class="hp-form-fieldset">
    {children}
  </fieldset>
</form>
```

No `action` attribute → posts to the current URL. Always `enctype="multipart/form-data"` so file uploads work on the PE path without extra opt-in.

JS-on submit interception: an `onSubmit` calls `e.preventDefault()` and posts via `fetch(window.location.href, { method: 'POST', body: new FormData(formEl), headers: { Accept: 'application/json' } })`. The fetch URL is `window.location.href` (matches what a native browser submit of `<form>` with no `action` attribute would do, so JS-on and JS-off resolve to the same target). On `__outcome: 'redirect'` it does a client-side navigation through the existing route navigation primitive (not `window.location.assign`); on `success` it triggers a loader reload; on `success`/`deny`/`error` it updates the internal store that `useActionResult()` reads from. The `fieldset[disabled]` wiring matches today.

### `useActionResult<TPayload, TResult>(stub?)`

Render-context hook returning the most recent result for an action invocation targeting the current page render:

```ts
type ActionResult<TPayload, TResult> =
  | { kind: 'success'; data: TResult; submittedPayload: TPayload }
  | { kind: 'deny'; status: number; message: string; data?: unknown; submittedPayload: TPayload }
  | { kind: 'error'; message: string; submittedPayload: TPayload | null }
  | null;
```

- On the PE path, the page re-renders after a deny/error with the outcome and the parsed payload injected into an `ActionResultContext` Provider in the SSR tree. The hook reads it (once per render; not a subscription).
- On the JS-on path, the same hook reads from a client-side store updated by `<Form>`'s submit handler.
- Passing the optional `stub` filters: returns `null` unless the stored result is for that specific action. Useful when multiple `<Form>`s coexist on a page. When no stub is passed, `TPayload` and `TResult` default to `unknown`.
- `submittedPayload` is `null` only when an error happened before the request body parsed (e.g. malformed multipart). In every other case it's the parsed payload as the action saw it.

Application code reads action result/error the same way regardless of JS state.

**Preserving form input values on deny re-render.** Because `submittedPayload` is in render context, inputs survive validation failures without controlled-component plumbing:

```tsx
const result = useActionResult(addTodoStub);
return (
  <Form action={addTodoStub}>
    <input name="text" defaultValue={result?.submittedPayload?.text ?? ''} />
    {result?.kind === 'deny' && (
      <p class="error">{result.data?.fieldErrors?.text ?? result.message}</p>
    )}
    <button>Add</button>
  </Form>
);
```

### `useFormStatus(stub?)`

Render-context hook returning pending state for an in-flight action submit:

```ts
type FormStatus = { pending: boolean };

function useFormStatus(stub?: ActionStub<unknown, unknown, never>): FormStatus;
```

- With a stub: pending is true while a submit of that specific stub is in flight.
- Without a stub: pending is true while *any* action submit on the page is in flight. Useful for a top-of-page indicator that doesn't know which form is active.
- On the PE path, always returns `{ pending: false }` (the page only renders after the request completes). The hook is meaningful only on the JS-on path; PE devs use the `fieldset[disabled]` that `<Form>` already provides.
- Mirrors React 19's `useFormStatus()` shape so the mental model transfers.

Use cases: a "Saving…" indicator outside the form, a separate submit button or cancel link that needs to gray out, a header progress bar that fires on any mutation.

### `useAction(stub)`

Stays for programmatic mutations (button clicks, non-form UI). Behavior change: it posts to the **current page URL** with `Accept: application/json`, not to `/__actions`. The hook's public return shape (`{ mutate, pending, error, data }`) is unchanged, so existing call sites keep working semantically. Internally it reads the new uniform envelope.

### `useOptimisticAction` — optimistic updates with `<Form>`

`useOptimisticAction` (added in PR #56) already wraps an action with an optimistic-state apply function. Its return shape is reshaped to *also* satisfy the `ActionStub` shape, so the same return value drives both imperative mutates and `<Form>` submits:

```ts
// Today's return:
type UseOptimisticActionResult<TPayload, TResult, TBase> =
  UseActionResult<TPayload, TResult> & { value: TBase };

// New return — additive: gains stub-compatible identity fields and a brand.
type UseOptimisticActionResult<TPayload, TResult, TBase> =
  & ActionStub<TPayload, TResult>     // identity: __module, __action, useAction
  & UseActionResult<TPayload, TResult> // mutate, pending, error, data
  & { value: TBase }                   // optimistic-applied state
  & { readonly [OPTIMISTIC_BRAND]: OptimisticBinding<TPayload, TBase> };
```

The brand is a private `Symbol` that `<Form>` and `useAction` detect at submit time and use to invoke the optimistic apply with the parsed payload before the network request. The apply, settle, and revert mechanics remain those of PR #56 (the underlying `useOptimistic` machinery is untouched).

Developer usage:

```tsx
const todos = useLoader(getTodos);
const addTodo = useOptimisticAction(addTodoStub, {
  base: todos.data,
  apply: (current, payload) => [...current, { ...payload, pending: true }],
});

return (
  <>
    <TodoList items={addTodo.value} />        {/* optimistic view */}
    <Form action={addTodo}>                   {/* one prop, zero wiring */}
      <input name="text" required />
      <button>Add</button>
    </Form>
  </>
);
```

No `onSubmit` prop on `<Form>`, no manual payload re-parsing, no `mutate`-call indirection. The same `addTodo` works imperatively too: `<button onClick={() => addTodo.mutate({ text: 'foo' })}>`. Existing imperative callers of `useOptimisticAction` keep working unchanged — the return shape gains fields; nothing is removed.

The optimistic declaration lives next to the state it modifies (alongside the loader), so `addTodo.value` is usable by any component on the page, not just inside the form.

### Why three hooks: `useAction`, `useActionResult`, `useFormStatus`

Different roles:

- `useAction`: imperative trigger from non-form UI; owns its own pending/error/data state for that call site.
- `useActionResult`: passive read of "did an action run for this page render and what happened" — covers the PE path (no client state available) and the cross-component case (form in one tree, error display in another). Also carries `submittedPayload` for `defaultValue` re-population.
- `useFormStatus`: passive read of "is a submit in flight right now" — JS-on only; covers UI outside the form that needs to reflect pending state.

## `deny()` signature

```ts
// Today:
deny(status: ContentfulStatusCode, message: string): DenyOutcome

// New (additive):
deny(
  status: ContentfulStatusCode,
  message: string,
  opts?: { data?: unknown; headers?: Record<string, string> }
): DenyOutcome
```

`headers` already existed on `DenyOutcome` but was not exposed on the constructor. `data` is the new field, typed `unknown`; framework plumbs it through unchanged to `useActionResult()`. Type-only breaking change to the `DenyOutcome` interface adds `data?: unknown`. Existing call sites compile.

Typical use:

```ts
defineAction(async (ctx, payload) => {
  const result = MySchema.safeParse(payload);
  if (!result.success) {
    throw deny(422, 'Validation failed', { data: { fieldErrors: result.error.flatten().fieldErrors } });
  }
  // ...
});
```

## Streaming actions

Streaming actions (`async function*` or `ReadableStream`-returning) are not PE-capable. A no-JS browser cannot consume SSE.

- `<Form action={streamingStub}>` is a type error (the `TChunk = never` constraint on `FormProps.action`).
- A streaming action invoked via raw form POST (someone hand-rolls the HTML) returns 405 Method Not Allowed with a body explaining streaming actions require `Accept: text/event-stream`.
- Streaming actions remain invocable via `useAction(stub)`; the client requests `Accept: text/event-stream` automatically.

Documented in `docs/streaming.mdx` as a known limitation of PE.

## Migration — hard cutover

No shims, no compat flags, per project norm (memory `feedback_no_schedule_pressure`).

1. `<Form mutate={...} pending={...}>` removed. New form: `<Form action={stub}>`. Rename is mechanical.
2. `/__actions` endpoint removed. The generated server entry no longer mounts the global `actionsHandler`. Page routes register POST handlers via the existing `routeServerModules` adapter.
3. `actionsHandler` factory deleted from `@hono-preact/server` public surface. Replaced by a per-page handler (likely `pageActionHandler` or inlined into the page route mounter; final placement settled in the implementation plan).
4. JSON envelope: success was bare JSON; now it's `{__outcome: 'success', data}`. Hand-callers of `/__actions` (not a documented integration) break. Listed in the changelog.
5. Existing `useAction` callers are source-compatible (return shape unchanged); only the request URL and envelope-parse logic change internally.
6. Existing tests for `actions-handler.ts` get rewritten against the new page-route handler. SSE tests stay valid (wire format unchanged from PR #58).

`apps/app` demo migration lands in the same PR. Demo getting a no-JS smoke is the integration test for the spec.

## Testing

- **Unit.** New page POST handler tested per content-negotiation branch: HTML 303 on return-data success, HTML 200+re-render on deny, real 30x on `redirect()`, JSON envelope shapes, 405 on streaming-via-form, 5xx on error.
- **Integration.** Existing actions test suite ported to the page-route shape. Add a no-JS scenario: a Vitest test that programmatically sends a `multipart/form-data` POST to a page URL with `Accept: text/html` and asserts the response is HTML containing the deny message and field errors (parsed from the re-render).
- **Bundle-content test.** New test pinning that `<Form>` SSR output emits the `__module`/`__action` hidden inputs (regression guard against silent breakage of PE).
- **E2E (out of scope, deferred follow-up).** Playwright with `javaScriptEnabled: false` exercising the full PE round-trip. Recommended but does not block the spec.

## Open items deferred to the implementation plan

Small enough that the plan settles them, not the spec:

- Exact location of `ActionResultContext` Provider in the SSR tree (likely wraps the page render near `LoaderHost`).
- Whether `useActionResult()` subscribes to a store on the client or snapshots once (PE = snapshot; JS-on = subscribe; the hook abstracts both, but the client-store shape is plan-level). Same store backs `useFormStatus()`.
- Exact `Symbol` and brand-detection mechanism on the `useOptimisticAction` return value, and how `<Form>` discriminates a plain stub from an optimistic-wrapped stub at runtime.
- Exact shape change to the `routeServerModules` adapter for registering page POST handlers (probably an `actionsByName: Record<string, ActionFn>` alongside the existing loader entries).
- Final naming for the per-page POST handler factory.

## Out of scope (carry-overs from the wave-level decisions)

- `URLPattern`, View Transitions L2 cross-document, `AsyncContext.Variable`, `Cache`/`CacheStorage` for `LoaderCache`, `CompressionStream` on SSE, alternative loader transports, customized built-ins, Sanitizer API, Speculation Rules on action/loader RPC. See the roadmap's "Out of scope for the whole wave" section.
