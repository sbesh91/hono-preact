# Signals migration (umbrella)

Date: 2026-07-22 (Phase 4 recorded 2026-07-24)
Status: In progress. Phases 0-2, Phase 5, and Phase 4 shipped on this branch.
Phase 5 made signals the always-on data-layer opinion; Phase 4 added the keyed
`<For>` / `<Show>` rendering helpers on that foundation. Remaining: Phase 3
(store conversion, re-opened by Phase 5) and the streaming-loader signals split
out of Phase 4, both stacking on top, out of order. This branch is the single PR
to `main`, held open until the owner is comfortable with the whole signals
transition.
Branch: `feat/signals-migration`

This is the charter for the signals-first migration. The work ships as **one
PR** to `main` (this branch); each phase lands as a stacked sub-PR whose base is
this branch, so the phases can be reviewed one at a time while only the umbrella
merges to `main`. Nothing here merges to `main` until the whole set is ready.

The rationale, the subsystem reconnaissance, the constraints, and the phasing
are in the investigation: `2026-07-22-signals-first-migration-investigation.md`
(brought into this branch with Phase 0). The compatibility and cost evidence is
in `2026-07-21-first-party-signals-design.md`.

## Why one PR

Phase 0 is pure modularity with a real byte cost and no user-facing payoff on
its own; the payoff arrives only once the signal-backed phases land on top of
it. Shipping the phases separately would put a size regression on `main` ahead
of its benefit. Bundling them means the cost and the benefit arrive together and
are reviewed as one story.

## Phases

Ordered by payoff-to-risk. Each is a stacked sub-PR into this branch.

| Phase | Scope | Sub-PR | Status |
| --- | --- | --- | --- |
| 0 | Decompose the loader runner (session / readers / reload). No signals, no behaviour change. | #341 | shipped (in this PR) |
| 1 | Presence roster as keyed signals (`memberIds` / `member(id)` on `useRoom`). Positioning DROPPED (see below). | #343 | shipped (in this PR) |
| 2 | Loader read-side as a signal mirror (`useDataSignal` / `useFieldSignal`). Single-value first; streaming a follow-on. | #344 | shipped (in this PR) |
| 3 | Optimistic queue and the action/form stores; per-field form errors. Delete `use-store-snapshot` / `use-force-update`. | | re-opened by Phase 5 (see below); stacks on top |
| 4 | Signals DX: keyed `<For>` / `<Show>` rendering helpers (per-row component boundary; atomicity proven). Streaming-loader signals split out (see below). | #346 | shipped (in this PR) |
| 4b | Streaming-loader signals (was Phase 4 Part B): a signal read channel for live loaders. | | future; needs the accumulator-typing design |
| 5 | Signals as the always-on data layer: delete the opt-in seam and the `hono-preact/signals` subpath; loaders and rooms are signal-backed with no opt-in import. | #345 | shipped (in this PR) |

**Phase 3 dropped (recorded 2026-07-24).** Assessment before starting it: the
optimistic queue, `action-result-store`, and `form-submit-store` all sit on the
**always-loaded** actions/forms path, not an opt-in one, and they carry no
granularity win to convert. The optimistic value is a single projected value
(not keyed). The action/form stores already narrow per-key through
`use-store-snapshot` (a consumer re-renders only when its own action's result
changes), so signals would only swap the mechanism. `use-store-snapshot` is in
fact deliberately hand-rolled to keep `@preact/signals`/compat off the
always-loaded path. Converting these would either tax every forms app (~3.3 kB,
violating zero-cost) or add dual-path complexity behind the opt-in seam for no
user-facing benefit. The one genuine granularity opportunity, per-field form
errors (the whole `FieldErrorsMap` is on one context today), is real but modest
(forms are not a per-frame hot path) and is folded into the Phase 4 roadmap. The
high-value granularity work (presence, loaders) is shipped; the migration stops
where the value stops.

**Phase 3 re-opened by Phase 5 (recorded 2026-07-24).** The drop rationale above
rested on the zero-cost invariant: converting the always-loaded store consumers
would either tax every forms app with `@preact/signals` or add dual-path
complexity behind the opt-in seam. Phase 5 retired that invariant for the data
layer and deleted the seam, so both objections are gone: signals is now always
present for a data-layer app, and there is no dual path to add. Converting the
optimistic queue and the action/form stores to signals now simply removes the
hand-rolled `use-store-snapshot` / `use-force-update` bridges (built precisely to
keep signals off the always-loaded path) rather than paying to keep them. The
per-field form-error granularity (splitting the single `FieldErrorsMap` context)
becomes worthwhile on the same foundation. Phase 3 stacks on top of Phase 5.

**Phase 4: signal rendering helpers (shipped, #346).** Phase 1's granular
presence shipped with the keyed `.map` consumption pattern
(`memberIds.value.map((id) => <Row sig={member(id)} />)`), granular on a presence
update but coarse on membership change (a join/leave re-renders the mapping
consumer and its rows). Phase 4 adds a Solid-style `<For each={memberIds}>` that
closes that gap: it caches each row by key so a join/leave reconciles by key
without re-rendering survivors, and runs each row inside a per-row component
boundary (the Preact-core `Item` / useRenderer pattern) so a signal read in the
child (inline or nested) subscribes that row and re-renders it alone. `<Show>` is
the conditional companion. Both are pure Preact (they read `.value` for ambient
auto-subscribe and import no `@preact/signals`, so the module-graph guard holds),
and atomicity is proven (a per-row / child signal re-renders only its own
component, not `<For>` / `<Show>`). `signal.map()` was dropped (it would need a
`Signal`-prototype monkey-patch). See `2026-07-24-signals-dx-design.md`.

The streaming-loader signals originally grouped here (a signal read channel for
live loaders) were **split into Phase 4b**: design review found the accumulator
type is chosen at the consumption site (the reducer), so a read-side
`useDataSignal()` cannot statically type it. That is a real API-design question,
deferred to its own spec rather than shipped as a type lie. The host plumbing
already exists, so 4b is a type/API problem, not a wiring one.

Positioning (`use-position.ts`), grouped into Phase 1 by the investigation,
was dropped: verification showed it already writes x/y straight to the DOM in
the `autoUpdate` callback and only `setState`s on a side/align/arrow change, so
it is already optimized. The residual re-render would need a breaking change to
the public `PositionState` type to remove, which is not worth it. The
investigation over-claimed it as a hot path.

Routing (the investigation's original Phase 4) remains entirely out of scope
(it is a preact-iso replacement decision, not a reactivity change) and is
unrelated to the DX Phase 4 above; the two just share a number across the two
documents.

**Phase 5: signals as the always-on data layer (shipped, #345).** Phases 1-2
made presence and loader data granular only when the app imported the opt-in
`hono-preact/signals` entry, behind a registration seam with a signals-free
default path. Phase 5 makes signals the data-layer opinion: the signal factories
moved into `internal/roster-signal.ts` and `internal/loader-signal.ts`, the
consumers (`use-room.ts`, `loader.tsx`, `define-loader.ts`) import them directly,
and the seam, the opt-in `signals.ts` entry, the `hono-preact/signals` subpath,
and the default paths are deleted. The observable behaviour is exactly the
Phase 1-2 signal-mode path (deletion of the alternative, not a rewrite), pinned
by the tests those phases already shipped plus a module-graph guard that keeps
`@preact/signals` reachable only through the two factory modules. See
`2026-07-24-signals-always-on-design.md`.

## Running cost

Measured with the repo's own probe, gzip. Core is the number the framework's
positioning rests on; per-feature deltas are the always-on plumbing each phase
adds. Updated as phases land.

| At | core | feature delta | note |
| --- | --- | --- | --- |
| Phase 0 | 4914 (+3) | loaders +258 B | structural, parameter passing over closure capture |
| Phase 1 | 5519 unchanged | realtime +~65 B | the signal-mode branch + lazy getters in `useRoom` |
| Phase 5 | 5521 unchanged | realtime 2261 B, loaders 10215 B (marginal) | seam removed; the `signals` opt-in bucket is gone, its glue folded into the two feature buckets |
| Phase 4 | 5521 unchanged | signals-dx 307 B (marginal) | pure-Preact `<For>` / `<Show>`; a new tree-shakeable bucket, imports no `@preact/signals` |

(The core number rebased across phases as `origin/main` advanced; what matters
is that each phase leaves core unchanged.) Through Phase 2 the signal glue was
its own opt-in bucket (the `signals` entry, ~289 B gz marginal) and
`@preact/signals` (~3.3 kB gz) was a peer only apps importing `hono-preact/signals`
installed. **Phase 5 removes that bucket and the opt-in:** `@preact/signals` is
still external in the probe (a peer the app installs), but it is now reached
through the always-loaded data-layer modules, so an app that uses a loader or a
room ships it unconditionally. An app that uses neither still ships no signals.

## Invariants every phase must hold

Carried from the investigation (§3) and proven on the spike:

- **The mirror law.** A signal is an additional read channel; the existing
  coarse value must stay reactive for its current consumers. The loader spike
  showed the naive failure: making the signal authoritative and simply skipping
  the host re-render freezes existing `useData()` / `.View()` consumers. Phase 1
  showed the clean resolution: keep the coarse value reactive by exposing it as a
  lazy getter that reads the store when a consumer accesses it (so a coarse
  `members` consumer still updates), and let the granular win come from granular
  consumers subscribing to one entity instead of the whole. The rule is
  "don't break the coarse consumer", not "always keep the old `setState`".
- **Render purity.** No signal write that notifies subscribers during the render
  pass. DOM cleanup stays deferred to effects.
- **Server error propagation stays throw-based.** The SSR deny/coldError path
  cannot move to a reactive channel.
- **Zero cost when unused (retired for the data layer by Phase 5).** Through
  Phase 2 this held: an app that did not opt into signals paid no `@preact/signals`
  bytes. Phase 5 deliberately reverses it for the data layer: signals is the
  opinion, so using a loader or a room now loads `@preact/signals` (~3.3 kB gz),
  measured and reported. The narrower invariant that survives: **core stays
  signals-free** (an app that touches neither the loader nor the room data layer
  ships no signals), enforced by the module-graph guard and the core size number.
