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
| 0 | Decompose the loader runner (session / readers / reload). No signals, no behaviour change. | #341 | in review |
| 1 | Presence roster as keyed signals; take floating-position out of the render path. | | not started |
| 2 | Loader read-side as a signal mirror (`useDataSignal` / `useFieldSignal`). Single-value first; streaming a follow-on. | | not started |
| 3 | Optimistic queue and the action/form stores. | | not started |

Routing (the investigation's Phase 4) is explicitly out of scope: it is a
preact-iso replacement decision, not a reactivity change, and does not ride
along here.

## Running cost

Measured with the repo's own probe against `origin/main`, loaders feature, gzip.
Updated as phases land.

| At | loaders total | delta vs main | note |
| --- | --- | --- | --- |
| Phase 0 | 9942 | +258 B | structural, parameter passing over closure capture; core unchanged |

The signal-backed phases add the `@preact/signals` cost (~3.3 kB gz) only for
apps that opt in; the always-paid plumbing is tracked here as it lands.

## Invariants every phase must hold

Carried from the investigation (§3) and proven on the spike:

- **The mirror law.** A signal is an additional read channel, never the sole
  source of truth, until every consumer of that source is converted. Making the
  signal authoritative and skipping the host re-render freezes existing
  `useData()` / `.View()` consumers.
- **Render purity.** No signal write that notifies subscribers during the render
  pass. DOM cleanup stays deferred to effects.
- **Server error propagation stays throw-based.** The SSR deny/coldError path
  cannot move to a reactive channel.
- **Zero cost when unused.** An app that does not opt into signals pays no new
  bytes beyond the phase's always-on plumbing, which is measured and reported.
