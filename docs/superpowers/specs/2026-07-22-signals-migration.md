# Signals migration (umbrella)

Date: 2026-07-22 (finalized 2026-07-24)
Status: Ready. Phases 0-2 shipped on this branch; Phase 3 dropped; Phase 4
is a future roadmap item, not part of this PR. This branch is the single PR
to `main`.
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
| 3 | Optimistic queue and the action/form stores. | | DROPPED (see below) |
| 4 | Signals DX: primitive rendering helpers (a keyed `<For>`, and other ergonomics), plus streaming-loader signals as the follow-on to Phase 2. | | future roadmap (not in this PR) |

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

**Deferred to Phase 4 (recorded 2026-07-24).** Phase 1's granular presence ships
with the keyed `.map` consumption pattern
(`memberIds.value.map((id) => <Row sig={member(id)} />)`), which is granular on
the frequent case (a presence UPDATE re-renders only the moved row) but coarse
on membership change (a join/leave re-renders the mapping consumer and its rows,
keyed reconciliation aside). A Solid-style `<For each={memberIds}>` would make
join/leave granular too by subscribing to the list internally and diffing by key
without re-rendering the parent. It was shown in an early Phase 1 API option but
dropped from the shipped design to keep the surface small; that tradeoff is now
owned, and the helper is deferred to a dedicated DX phase rather than bolted onto
Phase 1. Phase 4 is also the home for the streaming-loader signals Phase 2
leaves out (Phase 2 is single-value only).

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

## Running cost

Measured with the repo's own probe, gzip. Core is the number the framework's
positioning rests on; per-feature deltas are the always-on plumbing each phase
adds. Updated as phases land.

| At | core | feature delta | note |
| --- | --- | --- | --- |
| Phase 0 | 4914 (+3) | loaders +258 B | structural, parameter passing over closure capture |
| Phase 1 | 5519 unchanged | realtime +~65 B | the signal-mode branch + lazy getters in `useRoom` |

(The core number rebased between Phase 0 and Phase 1 as `origin/main` advanced;
what matters is that each phase leaves core unchanged.) The opt-in signal glue
is its own bucket: the `signals` entry is **289 B gz marginal**. `@preact/signals`
itself (~3.3 kB gz) is a peer only apps that import `hono-preact/signals` install;
it is external in the probe. An app that never imports the entry pays only the
per-feature plumbing above.

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
- **Zero cost when unused.** An app that does not opt into signals pays no new
  bytes beyond the phase's always-on plumbing, which is measured and reported.
