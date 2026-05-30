# Demo view transitions design

**Date:** 2026-05-30
**Status:** Approved, pending implementation plan

## Goal

Exercise the v0.4 View Transitions toolkit inside the `apps/site` demo issue
tracker. Today the demo only gets the default root fade (`root.css`); none of
the toolkit primitives (named elements, direction types, lifecycle, Persist)
are shown. The drill-down hierarchy is a textbook fit for shared-element
morphs and directional slides, so this turns the demo into a live showcase.

## Demo structure (unchanged)

- `/demo/projects` — projects list (project name + open/total counts).
- `/demo/projects/:projectId` — `project-layout` wraps:
  - `` — project issues list (rows of `IssueRow`).
  - `issues/:issueId` — issue detail.

`project-layout` stays mounted across the issue-list ↔ issue-detail
navigation, so transitions between those two happen inside the layout's
content area. Entering a project from `/demo/projects` mounts the layout
fresh, which is where the project-name morph lands.

## Effects

Three coordinated effects, no new dependencies, all in the existing demo
files plus `root.css`.

### 1. Directional page slides (direction types)

The route-change dispatcher already auto-emits `nav-push` / `nav-back` /
`nav-forward` (and always `nav-same-origin`; `nav-initial` on the first
dispatch). Add CSS in `root.css` keyed on `:active-view-transition-type(...)`:

- **Drilling in** (`nav-push`, `nav-forward`): new page slides in from the
  right, old slides out to the left.
- **Browser back** (`nav-back`): the reverse, new slides in from the left,
  old out to the right.
- `nav-initial` and unsupported browsers keep the existing fade.

**Known limitation (intentional):** the in-app up-links (e.g. "← all
projects") are normal `<a href>` navigations, which the framework classifies
as `push`, not `back`. They slide in the forward direction. Only the
browser/OS back button reads as `nav-back`. We do not fake history direction
per-link (would require custom `useViewTransitionTypes` types on each up-link)
because the honest link-nav behavior is acceptable for a demo.

### 2. Shared-element morph: issue row → issue header

- `IssueRow.tsx`: wrap the issue title and status badge in
  `<ViewTransitionName name={`issue-title-${issue.id}`} groupClass="issue-card">`
  and `name={`issue-status-${issue.id}`}`. Each row's id is unique on the
  list page, satisfying the per-page uniqueness requirement of
  `view-transition-name`.
- `issue.tsx` (`IssueHeaderAndActions`): put the matching names on the detail
  `<h2>` title and the status badge.

Clicking a row morphs that title + badge from the list position into the
detail header while the rest of the page slides. The `issue-card` group class
is tuned in CSS using the existing `--spring-soft` / `--spring-duration`
tokens for a gentle morph.

### 3. Shared-element morph: project name → project header

- `projects.tsx`: name each project link `project-${p.slug}`.
- `project-layout.tsx`: put the same `project-${slug}` name on the header
  `<h1>`.

The project name morphs up into the layout header when a project opens. The
text differs (list shows the full name, layout shows the uppercased slug); the
box morphs and the text crossfades, which reads fine.

## Out of scope (deliberate YAGNI, not oversights)

- **Persist** — no audio/video/long-lived widget in this demo to justify it.
- **Lifecycle hooks** — nothing here needs to mutate the DOM mid-transition.

## Accessibility

Every new animation is zeroed under
`@media (prefers-reduced-motion: reduce)`, matching the existing root-fade
treatment.

## Files touched

- `apps/site/src/styles/root.css` — directional slide keyframes + types,
  `issue-card` group animation, reduced-motion guards.
- `apps/site/src/components/demo/IssueRow.tsx` — named title + status badge.
- `apps/site/src/pages/demo/issue.tsx` — matching names on detail header.
- `apps/site/src/pages/demo/projects.tsx` — named project links.
- `apps/site/src/pages/demo/project-layout.tsx` — matching name on header.

## Verification

- `pnpm --filter site build` succeeds.
- Manual: drilling projects → issues → issue slides forward; browser back
  slides reverse; the clicked issue title/badge morphs into the detail header;
  the project name morphs into the project header.
- `prefers-reduced-motion: reduce` disables all motion.
