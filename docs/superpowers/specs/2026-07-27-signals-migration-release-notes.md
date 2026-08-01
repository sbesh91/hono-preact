# Signals-first data layer: release notes (#342, cut pending)

The framework's data layer is reactive. Four hooks that returned a value now
return a `ReadonlySignal` of that value, and `@preact/signals` ships as a
dependency of `hono-preact` rather than as something an app opts into.

The whole migration is one edit repeated: **add `.value`.** For most apps that
is two or three lines.

The reason this document is long anyway is the section titled "The compiler will
not catch this". Wrapping a value in a signal is not the kind of type change
`tsc` reliably points at, because a `Signal` is a real object with real
`valueOf` / `toString` / `toJSON` methods. Any site that read the value and did
something with a *field* of it breaks loudly and gets fixed in seconds. Any site
that used the value as a whole (a truthiness gate, a dependency array, an
identity comparison, an analytics payload) keeps compiling, and several of those
keep *appearing* to work. Those are enumerated below, with the probe results
that confirmed each one.

## Versions

Not yet cut. This is the signals half of the next minor; the type-hygiene half
is in `2026-07-26-v0.13-release-notes.md`. Both land in the same release.

---

## Do I have to do anything?

| Symbol | Severity | Action |
|---|---|---|
| `loader.useData()` | Compiler-caught | Add `.value`. |
| `useActionResult()` | **Mixed** | Add `.value`. Compiler-caught if you read a field; **silent** if you only tested it for truthiness. |
| `useFormStatus()` | Compiler-caught | Add `.value`. |
| `useOptimistic()` | **Mixed** | Add `.value` at the read sites. Compiler-caught for field/method access; **silent** in a dependency array. Also see the new `base` stability requirement below, which is a runtime change. |
| `FieldErrorsMap` | Compiler-caught | Messages are `readonly string[]`. Copy before sorting or reversing. |
| `LoaderDataContext` (`hono-preact/internal`) | Compiler-caught | Now holds a signal. |
| `subscribeFormSubmit` / `subscribeLastActionResult` (`hono-preact/internal`) | Compiler-caught | Gone. Use `pendingSignal` / `lastActionResultSignal`. |
| `useRoom().members` / `.self` | **Mixed** | Add `.value`. Compiler-caught if you call an array method or read a field; **silent** if you only read `.length` off `members`, or tested `self` for truthiness (a signal is always truthy). |
| `preact` peer range | Install-time | Now `>=10.25.0`. |

**Silent** means it compiles and behaves differently. **Compiler-caught** means
`tsc` points at the line.

Everything else is additive: `useRoom` gains `memberIds` / `member(id)`, a
streaming loader gains `useData(initial, reduce)` and a usable `.Boundary`,
`useFieldErrors(name)` gains a per-field overload, and the barrel re-exports the
`@preact/signals` primitives so apps do not add a second dependency on it.

---

## The four hooks

### `loader.useData()`

```diff
-const { data, status } = moviesLoader.useData();
+const { data, status } = moviesLoader.useData().value;
```

Or, to get the granularity the change exists for, hold the signal and read it
where it is used:

```tsx
const state = moviesLoader.useData();
return <Title state={state} />; // <Title> re-renders alone on a reload
```

The value inside is the same `LoaderState<Serialize<T>>` discriminated union as
before; pattern-match on `.value.status`.

### `useActionResult()`

```diff
-const result = useActionResult(serverActions.addMovie);
+const result = useActionResult(serverActions.addMovie).value;
 if (result?.kind === 'deny') { /* ... */ }
```

`ActionResult<P, R>` still includes `| null`, and the `null` is now **inside**
`.value`. See the silent-break section: this is the change most likely to slip
through.

### `useFormStatus()`

```diff
-const { pending } = useFormStatus(serverActions.addMovie);
+const { pending } = useFormStatus(serverActions.addMovie).value;
```

One implementation detail worth knowing, because it is the reason this hook is
worth using rather than a plain subscription: the two inhabitants of
`FormStatus` are frozen singletons (`{ pending: false }` and `{ pending: true }`)
rather than a fresh object literal per projection. A `computed` propagates only
when its value changes by `===`, so a fresh literal would push every reader on
every begin/end submit anywhere in the app, including readers bound to an
unrelated action. Do not compare a `FormStatus` by identity to a literal you
constructed; read `.pending`.

### `useOptimistic()`

```diff
-const [movies, addOptimistic] = useOptimistic(base, apply);
-return <ul>{movies.map(...)}</ul>;
+const [movies, addOptimistic] = useOptimistic(base, apply);
+return <ul>{movies.value.map(...)}</ul>;
```

The dispatch function is unchanged. `useOptimisticAction` keeps working at the
call site: `value` is now a lazy getter over the signal, so reading it during
render subscribes the component exactly as the previous snapshot did. The hook
also exposes that signal directly, as `signal`, so a caller that hands it to a
child gets the same leaf-level updates the primitive offers, and a caller that
never reads `value` is no longer subscribed at all.

**This hook also has a runtime requirement that did not exist before.** `base`
must be a stable reference across renders. The hook now tracks it reactively, so
a `base` built fresh on every render, an inline `?? []` fallback, an inline
`.filter(...)`, or a spread, re-derives the projection every render; because a
consumer binds the returned signal, that is a re-render loop. Give the loader
field a stable empty default, or memoize the expression, before passing it:

```diff
-const [items] = useOptimistic(data?.movies ?? [], apply);
+const movies = data?.movies ?? EMPTY; // module-level `const EMPTY = []`
+const [items] = useOptimistic(movies, apply);
```

---

## The compiler will not catch this

The design note for this migration leads with "simple compiler-guided transition
(add `.value`)" and then qualifies it correctly further down: `§7` of
`2026-07-25-signal-stores-design.md` already names the coercion sinks and the
frozen dependency array, and already says the repo has no linter to backstop
either. This section exists to put those in front of users rather than leaving
them in a design doc, and to add the one case that note does not cover: the
truthiness gate.

Every case below was confirmed by compiling it against the real declarations,
with a mutation check (a deliberately-wrong `@ts-expect-error`) to prove the
probe was actually being typechecked rather than silently skipped.

Caught by `tsc`, as expected:

- any property read (`result.kind`, `status.pending`)
- passing the value to a parameter typed as the old shape

Not caught:

### 1. A truthiness gate on `useActionResult()`

```ts
const result = useActionResult(addMovie);
if (result) {
  // Was: "an action ran". Now: always taken, on every render.
}
```

`ActionResult` keeps its `| null` inside `.value`, so the hook's return type went
from a nullable union to a non-nullable object. A truthiness test on a
non-nullable object type is not an error in TypeScript (unlike the same test on a
function, which is `TS2774`). The gate compiles unchanged and is now a constant
`true`. The same applies to `result === null`, `result != null`, and
`if (!result) return null`, all of which invert their meaning silently.

### 2. Dependency arrays and identity comparisons

```ts
const status = useFormStatus(addMovie);
useEffect(() => { /* ... */ }, [status]); // never re-runs
```

The hook's signal is created once (`useComputed` is `useMemo(..., [])`), so it
is identity-stable for the component's whole lifetime. The dependency array
freezes at mount. `useMemo`, `useCallback`, a manual `prev !== next` guard and a
`memo` comparator all fail the same way. Write `[status.value]` (or
`[status.value.pending]`) instead, or move the work into `useSignalEffect`.

This is the failure the dogfood migration hit: `Board.tsx:155` had to change
`[visibleTasks]` to `[visibleTasks.value]`, and nothing but a behavior test
would have found it.

### 3. Sinks typed `unknown` or `any`

```ts
track('submit', useActionResult(addMovie)); // track(name: string, payload: unknown)
```

Compiles. The analytics call now receives a `Signal` object; any consumer that
reaches for `payload.kind` at runtime gets `undefined`.

### 4. String and JSON coercion

```ts
`${status}`; String(status); JSON.stringify(status);
```

`Signal.prototype` defines `valueOf`, `toString` **and** `toJSON`, so all three
compile and all three still produce the right output. That is what makes them
dangerous: they are not bugs, they are camouflage. A value that reaches the DOM
only through a template literal looks migrated when it is not, and the first
symptom appears at whichever adjacent site (a dependency array, a gate) does
break.

### How to find them

There is no type-level fix. The practical sweep, in order of yield:

1. `rg 'useActionResult|useFormStatus|useOptimistic|useData\(\)'` and read every
   hit, rather than trusting a clean `tsc`.
2. Grep dependency arrays for the bound names.
3. Grep for truthiness gates and `=== null` on action results specifically.

A test that asserts a component's **render count** across a state change is the
only mechanical check that catches the frozen-dependency class. The migration's
own test suite did not have one, which is how the class survived review.

---

## `StreamStatus` gains `reconnecting`

`StreamState` has a new arm, `{ status: 'reconnecting'; data: T }`, reported while a live loader
consumed under `.Boundary` + `useData(initial, reduce)` resubscribes over chunks it already
delivered. The arm CARRIES data, so the last good fold stays on screen for the duration.

Additive, with one caveat: an EXHAUSTIVE `switch` over `StreamStatus` that has no `default` will
now fail to compile until it handles the new member. That is the intended outcome -- the alternative
was a status the framework could not express, which is what let a reconnect after a failure strand
a cleared error and report a fabricated one.

`useReload().reloading` stays `false` for these consumers on purpose. It lives on the loader host,
and making it follow a live stream would re-render that host on stream activity, which is what
collect-mode exists to avoid. Branch on `status === 'reconnecting'` and only the component reading
it updates.

## One behaviour change that is not a type change

Importing `@preact/signals` installs a `Component.prototype.shouldComponentUpdate`, so **a
component that touches a signal is memoized on its props**: when its parent re-renders, it
re-renders only if a prop changed by `===` or one of its own signals did. Calling
`loader.useData()` is enough to arm it, read or not.

Nothing you would expect to propagate stops propagating. Measured on 2.9.4, not assumed: context
changes, new-identity props, `children`, local `useState` and signal writes all still re-render.
The single exception is a prop object mutated IN PLACE:

```tsx
model.title = 'published';  // same object, new contents
forceParentRerender();      // a signal-touching child does NOT update
```

This is the hazard `memo()` has always had, now on by default. It is a real difference from the
previous release, where nothing was memoized, so it is listed here even though it is not a type
change and the compiler cannot see it. Loader, action and room data is new on every update and is
unaffected; this only reaches state you own and mutate yourself.

We keep the optimisation rather than disabling it (a one-liner, and the suite passes either way)
because the framework dedupes `@preact/signals` to one copy, so switching it off would also switch
it off for an app that imported the library directly and expects it.

## `hono-preact/internal`

This subpath carries no semver guarantee, but it is the one `optimistic-ui.mdx` tells users to
import `OptimisticOverlay` from, so anything reachable there is worth listing.

| Was | Is | Migration |
|---|---|---|
| `subscribeFormSubmit(cb)` | `pendingSignal` | Read `pendingSignal.value`, or drop the subscription and let a `useComputed` track it. |
| `subscribeLastActionResult(cb)` | `lastActionResultSignal` | Same shape. |
| `LoaderDataContext: Context<LoaderState \| StreamState \| null>` | `Context<ReadonlySignal<LoaderData> \| null>` | Add `.value`: `useContext(LoaderDataContext)?.value`. |
| `<Loader>`'s `accumulate?` | `mode` (required) | Pass `resolveLoaderMode(accumulate, isStreaming)`, now exported alongside `LoaderMode` from this subpath. |

The two subscribe exports are a straight rename: the store they wrapped is a signal now, so the
callback registry they existed to provide has no remaining purpose.

`LoaderDataContext` is the more interesting one. There used to be TWO loader-data channels, a state
context and a signal context, which is how `<OptimisticOverlay>` came to re-provide only one of
them and stop working entirely while its own test suite stayed green. There is one channel now, and
it carries a signal.

**`<Loader>`'s `mode` was unusable, and that is fixed here rather than merely documented.** It became
required, but `LoaderMode` was exported from neither `hono-preact` nor `hono-preact/internal`, so a
TypeScript consumer of this subpath could not construct the prop at all -- and a JS consumer (or a
stale-typed one) got `TypeError: Cannot read properties of undefined (reading 'kind')` on both the
SSR and hydrate paths, i.e. a 500 rather than the loader's own error fallback. `resolveLoaderMode`
and `LoaderMode` are now exported from `hono-preact/internal`, so the prop can be built the same way
`.Boundary` and `.View` build it.

## Additive

### `useRoom().members` and `.self` are signals

They were a `ReadonlyArray` and a plain entry; they are now
`ReadonlySignal<...>`, matching `memberIds` and `member(id)`, which were signals
already. Add `.value`:

```diff
-{members.map((m) => <Row key={m.id} member={m} />)}
+{members.value.map((m) => <Row key={m.id} member={m} />)}

-{self?.state?.name}
+{self.value?.state?.name}
```

**Why this changed rather than staying an array.** The array was reactive but
did not say so. Reading it during render subscribed your component and worked;
reading it from a `useEffect` returned a snapshot that never updated again,
because an effect body is not a tracking context and the hook no longer
re-renders its host on presence frames. There was no compile error and no
warning, and the type offered nothing to subscribe to. As a signal it is honest,
and the imperative path exists:

```tsx
useEffect(() => members.subscribe((roster) => drawAvatars(roster)), []);
```

**Watch the silent cases.** `members.value.length` is compiler-caught, but
`members.length` on a signal is `undefined` rather than an error at runtime if
you are on plain JS, and `if (self)` is now always true because a signal is an
object. Test `self.value`.

- **`useRoom` gains `memberIds` and `member(id)`.** `memberIds.value` changes on
  join/leave only; `member(id).value` changes only when that member's presence
  changes, so a row bound to it re-renders alone. The binding is stable: hold it
  across joins, leaves, presence updates and reconnect snapshots. **Do not
  re-read `member(id)` on every render** to work around perceived staleness;
  that discards the subscription and is exactly the pattern that let a roster
  bug pass twelve existing assertions.
- **Streaming loaders gain a real consumption surface.** `useData(initial, reduce)`
  folds every chunk and returns a `ReadonlySignal<StreamState<Acc>>`; `.Boundary`
  on a streaming loader is now a collect-mode host instead of `never`. Multiple
  consumers under one host fold the same underlying stream independently. The
  accumulating `.View(render, { initial, reduce })` form is unchanged.
- **`useFieldErrors(name)`** returns just that field's messages and subscribes
  only to that field. The no-argument form still returns the whole map.
- **The signals primitives are re-exported** from `hono-preact`: `signal`,
  `computed`, `effect`, `batch`, `untracked`, `useSignal`, `useComputed`,
  `useSignalEffect`, plus the `Signal` and `ReadonlySignal` types. Import them
  from the framework rather than adding `@preact/signals` to your own
  `package.json`, so there is one copy in the graph. `@preact/signals` fails
  *silently* when duplicated: a `computed` in one copy never subscribes to a
  signal from the other. The Vite plugin dedupes both `@preact/signals` and
  `@preact/signals-core` for the same reason.
**Not in this release:** the `<For>` / `<Show>` rendering helpers. They were
built in Phase 4 and **cut before release** (2026-07-27), because the vnode cache
that gives `<For>` its granularity is the same thing that freezes a row against
any non-signal input it closes over. Fixing that changes the child signature, so
it had to happen before a release rather than after one. Nothing shipped, so
nothing breaks; the work is preserved on `feat/signals-rendering-helpers`.

---

## Cost

Per-feature runtime, marginal over `core`, gzip, head versus base:

| Bucket | Δ |
|---|---|
| core | −24 B |
| loaders | +3.8 KB |
| actions | +3.3 KB |
| realtime | +3.1 KB |

As whole bundles:

| App shape | Base | Now | Δ |
|---|---|---|---|
| typical (loaders + actions + routing + transitions) | 19,792 B | 23,967 B | **+4,175 B (+21.1%)** |
| realtime app (typical + realtime) | 21,394 B | 25,740 B | +4,346 B (+20.3%) |
| no data layer (routing + transitions + head) | 7,791 B | 7,772 B | −19 B |

Of the +4,175 B, roughly 3,300 B is `@preact/signals` itself. **The per-feature
rows do not sum**: each measures `core + that one feature`, so each already
includes the whole signals runtime. Measured cumulatively, the way an app
bundles, the first data-layer feature pays the toll and the rest are nearly
free (core 5,494 B; +loaders +11,186; +actions +5,625; +realtime +1,936, against
3,512 B for `@preact/signals` alone). An app using loaders, actions and realtime
pays roughly what an app using loaders alone pays.

An app with no data layer is unchanged, and core stays signals-free.

---

## Why

Two properties, both measured rather than asserted:

- A presence update re-renders one member's row, not the roster.
- A loader reload re-renders the components bound to the fields that changed,
  not the `.View` subtree.

Neither is reachable without a reactive primitive that survives being handed
across a component boundary, which is what a signal is and what a `useState`
snapshot is not. The alternative the framework had was per-consumer `memo` plus
hand-written equality, which is the same work moved into every app.

The cost of that is one dependency, unconditional for any app with a data layer,
and one rule to learn: hold the signal, read `.value` where you use it.
