# v0.14 Track A, batch 1: core / iso ergonomics (#318)

Status: approved, ready for planning
Issue: #318 `[08] Second-tier ergonomics batch: core / iso`
Milestone: v0.14

## Scope

#318 lists ten bullets under a "small fixes, dev-warns, doc corrections, renames"
framing. Four of them are load-bearing API decisions rather than fixes, and the
issue's own rule says those get promoted to their own issues rather than forced
into the batch. This spec covers the six that survive that triage; the four
promoted items are listed below so the batch's boundary is explicit.

Three of the ten premises had drifted since #260 was filed on 2026-07-20. Each is
noted where it applies. The line numbers in #318 itself are stale and should not
be trusted while implementing.

## In scope

### 1. `useParams` dev-warn on no-match

**Premise partly stale.** `useParams` no longer asserts. It is a plain typed read
over `useRoute().pathParams` with a sanctioned-boundary comment
(`packages/iso/src/use-params.ts:15-20`), so the "asserts unconditionally"
complaint no longer describes the source.

What survives: when the named route does not match the active route, the hook
returns a params object that does not have the shape its type promises, with no
signal to the author. Add a dev-only warning on that mismatch. Production is
unchanged (no added cost, no throw).

Document `useRouteMatch` as the optional form in the same pass. Confirm it exists
and is exported before writing the doc; if it does not, drop that half and note
it in the PR rather than inventing the API.

### 2. `definePage` omission silently drops the route error boundary

A leaf view that skips `definePage` loses its route error boundary with no
signal. Add a dev-only check that leaf views carry the `definePage` marker, and
warn when one does not.

Dev-only, no API change, no production cost.

### 3. `RouteBinder.room` `Data` default drift

**Confirmed.** `packages/iso/src/server-route.ts:188` defaults `Data` to
`Record<string, unknown>`; `packages/iso/src/define-room.ts:224,243` defaults it
to `undefined` after #203. Align `server-route.ts` to `undefined`.

A type-only change. It is breaking for anyone relying on the wider default, which
is the correct break: the two spellings of the same concept must not disagree.

### 4. Rename the loader `params` cache-dep list

`params` (`define-loader.ts:215`, the cache-dependency list, `string[] | '*'`)
and `paramsSchema` (`:219`, the path-params schema) read as a pair but are
unrelated. The collision is load-bearing enough that the issue's framing is
"rename it before it fossilizes."

Rename the cache-dep list to **`cacheKeyParams`**. `paramsSchema` keeps its name;
it is the one whose name is right. `cacheKeyParams` says what the list is for
(which params participate in the cache key) rather than what it contains, and it
cannot be misread as a variant of `paramsSchema`. Planning may substitute a
better name, but it ships with a name, not a placeholder.

Breaking. v0.14 carries no non-breaking commitment.

### 5. `mutate` never settles after a same-origin redirect

**Confirmed bug**, and the source says so: `action.ts:724-728` returns
`new Promise(() => {})` under the comment `Same-origin redirect issued; this
promise never settles.`

The current behaviour is deliberate (the component is navigating away, so caller
code should not run mid-navigation) but the cost is that `await mutate()` dead-ends,
`.finally()` never fires, and every redirecting call leaks a pending promise.

**Fix: make `kind` the uniform discriminant of `MutateResult`.** The failure arms
already carry `kind`; the success arm is the only arm without one.

```ts
export type MutateResult<TResult, TDenyData = unknown> =
  | { ok: true; kind: 'success'; data: Serialize<TResult> | undefined }
  | { ok: true; kind: 'navigated' }
  | { ok: false; kind: 'deny'; deny: DenyRecord<TDenyData> }
  | { ok: false; kind: 'error'; error: Error };
```

Rejected alternatives:

- A bare fourth arm `{ ok: true, navigated: true }` leaves the `true` side
  discriminated by a property one arm lacks.
- `{ ok: true; data; navigated?: boolean }` keeps `if (r.ok) use(r.data)`
  compiling while handing back `undefined`. That is the same falsy-value trap
  bullet 2 of #318 exists to complain about.

The chosen shape turns every affected call site into a compile error instead of a
silent `undefined`, which is the point.

Behaviour to specify and test:

- The promise settles with `{ ok: true, kind: 'navigated' }` on a same-origin
  redirect.
- `onSuccess` does **not** fire for this arm, matching today's no-op `navigated`
  handler at `action.ts:682`.
- Callers must not assume the component is still mounted on this arm; document
  it on the type.
- `applyInvalidate` **runs** on the navigated path. Today it is skipped by the
  early return at `action.ts:724`. A mutation that redirects almost always
  redirects to a page rendering the data it just changed, so skipping
  invalidation is how that page serves a stale cached loader. Settling the
  promise removes the reason the early return existed, so invalidation moves
  ahead of it. Test this directly: a redirecting mutation must invalidate its
  declared loaders.

This is the second consecutive breaking change to `MutateResult` (v0.13 split it
three ways). Name that plainly in the release notes rather than letting readers
discover it.

### 6. `buildPath` multi-segment wildcard paths

`buildPath` cannot build a wildcard path with real path separators. Today this is
a *documented* limitation: `build-path.ts:17-19` percent-encodes embedded `/` as
`%2F` and tells the caller to build that part of the path themselves.

Accept `string[]` for rest params (`:rest*`, `:rest+`), joining with `/` and
encoding each segment individually. Plain `string` keeps its current
percent-encoding behaviour, so this is additive and the docstring's existing
promise stays true for existing callers.

## Out of scope: promoted to their own issues

Each gets a new issue on v0.14, referencing #318:

1. **A `match()` helper for status-first narrowing.** New public API surface;
   needs its own design. (#318 bullet 2)
2. **Splitting `invalidate`'s tri-mode** (`'auto' | false | LoaderRef[]`,
   `action.ts:221`) into clear-only vs refetch semantics. A breaking change to
   cache semantics, not a rename. (bullet 3)
3. **`View` generics.** The proposed two-parameter render `(state, props)` is a
   breaking change to a core API. It also carries an **unverified premise**: the
   issue claims `Acc` never infers from `initial`, but `Acc` does appear in
   `initial: Acc` (`define-loader.ts:152-156`). The promoted issue must open with
   a reproduction before any redesign. (bullet 4)
4. **`NavLink` prefetch integration.** `usePrefetch` exists
   (`packages/iso/src/use-prefetch.ts`) but `nav-link.tsx` has no prefetch
   surface at all. Wiring it means choosing a policy (hover / viewport / eager)
   and adding prop surface. (bullet 10)

## Testing

- Items 1 and 2 are dev-only warnings: assert the warning fires on the bad path
  and does **not** fire on the good path, and that production builds carry
  neither the check nor its cost.
- Item 3 is type-only: a `*.test-d.ts` assertion that the two `Data` defaults
  agree, so the drift cannot silently return.
- Item 5 needs a test at the **caller**: a `mutate()` against a handler that
  issues a same-origin redirect must settle with the `navigated` arm. A test that
  only exercises the decode helper proves nothing about the call site, which is
  where the bug lives.
- Item 6 needs round-trip coverage for `string[]` (multi-segment) and a
  regression test that plain `string` still percent-encodes, so the additive
  change cannot quietly alter existing behaviour.
- Mutation-check each new regression test: confirm it fails against the
  unfixed code before trusting it.

## Sequencing

One PR for the six items, since they are independent and each is small. Item 5 is
the one carrying real risk and should be reviewed on its own merits even inside a
batched PR; if review pressure suggests it, split it out rather than letting it
ride on the batch's low-risk average.

The four promoted issues are filed as part of this work but implemented later.

## Acceptance

- Six items implemented, each with the tests above.
- Four new issues filed on v0.14, each linking back to #318, with the promoted
  content and (for `View`) the reproduction requirement.
- #318 closed, with the triage recorded on the issue so the dropped bullets are
  traceable.
- Breaking changes (`MutateResult`, the loader `params` rename, the `room` `Data`
  default) called out in the v0.14 release notes.
- Full pre-push CI sequence green per CLAUDE.md.
