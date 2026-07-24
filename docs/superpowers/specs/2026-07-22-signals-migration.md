# Signals migration (umbrella)

Date: 2026-07-22
Status: In progress. This branch is the single PR that ships the whole
migration to `main`.
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
| 0 | Decompose the loader runner (session / readers / reload). No signals, no behaviour change. | #341 | merged into umbrella |
| 1 | Presence roster as keyed signals (`memberIds` / `member(id)` on `useRoom`). Positioning DROPPED (see below). | #343 | merged into umbrella |
| 2 | Loader read-side as a signal mirror (`useDataSignal` / `useFieldSignal`). Single-value first; streaming a follow-on. | | in progress |
| 3 | Optimistic queue and the action/form stores. | | not started |

Positioning (`use-position.ts`), grouped into Phase 1 by the investigation,
was dropped: verification showed it already writes x/y straight to the DOM in
the `autoUpdate` callback and only `setState`s on a side/align/arrow change, so
it is already optimized. The residual re-render would need a breaking change to
the public `PositionState` type to remove, which is not worth it. The
investigation over-claimed it as a hot path.

Routing (the investigation's Phase 4) is explicitly out of scope: it is a
preact-iso replacement decision, not a reactivity change, and does not ride
along here.

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
