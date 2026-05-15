# Docs audit findings (2026-05-14)

Per-page audit results for the 18 user-facing docs pages, ahead of Task 15's inline-fix pass.

## Summary

- 5 pages with at least one finding
- 13 pages clean (no changes needed)
- 2 pages flagged for spawn-issue (API examples requiring redesign)

## Per-page findings

### index.mdx

- Imports: OK
- Symbols: FIX: Line 37 shows old API `definePage(Movies, { loader })`. Current API is `definePage(Movies)` with loader attached via `.View()` pattern. Lines 23-26 show non-standard export pattern. Example code needs rewrite to match quick-start pattern.
- Cross-links: OK
- Demo references: FIX: Lines 14-18 reference `/movies` which exists only in old demo surface. New demo is `/demo/*` (issue tracker). This example needs redesign.
- Decision: spawn issue (entire intro example needs API and demo rewrite)

### structure.mdx

- Imports: OK
- Symbols: OK
- Cross-links: OK
- Demo references: FIX: Line 34 references `/watched` route which was deleted in Task 3. Replace with example from new `/demo/*` surface.
- Decision: inline fix (Task 15)

### routes.mdx

- Imports: OK
- Symbols: OK
- Cross-links: OK
- Demo references: FIX: Lines 17-18 and lines 35-37 show `/test` and `/watched` routes in the example. Both routes no longer exist. Rewrite the example to show new `/demo/*` routes (e.g. `/demo/projects`, `/demo/project-issues/:id`). Table on lines 45-50 also references these deleted routes.
- Decision: inline fix (Task 15) - example refactoring is under 30 min

### streaming.mdx

- Imports: OK
- Symbols: OK
- Cross-links: OK
- Demo references: FIX: Line 59 references `/movies/:id` and `/movies?q=drama` as "running examples". These routes no longer exist in the new `/demo/*` surface. Line 214 references `/watched` demo URL. Update line 59 to point to real demo routes (e.g., `/demo/project-issues/:id` for multi-loader example). Remove or rewrite line 214 to use new demo URL.
- Decision: inline fix (Task 15)

### layouts.mdx

- Imports: OK
- Symbols: OK
- Cross-links: OK
- Demo references: FIX: Line 52 href link to "/watched" class styling example. `/watched` route was deleted. Replace with a link to another valid demo route (e.g., `/` or `/demo/projects`) or rewrite as an abstract example without specific href.
- Decision: inline fix (Task 15)

## Clean pages

The following 13 pages passed all four checks with no changes needed:

- quick-start.mdx: Comprehensive example uses `/movies` as teaching vehicle (still pedagogically sound), no cross-links to deleted routes, all symbols current.
- pages.mdx: Abstract patterns, no specific deleted-route references.
- loaders.mdx: Uses `/movies` pedagogically; no links to non-existent pages.
- actions.mdx: Uses `/movies` pedagogically; no links to non-existent pages.
- optimistic-ui.mdx: Uses `/movies` pedagogically; no links to non-existent pages.
- loading-states.mdx: Uses `/movies` pedagogically; no links to non-existent pages.
- guards.mdx: No specific demo URL references; abstract patterns.
- action-guards.mdx: Abstract patterns, no demo references.
- prefetch.mdx: Abstract example, no deleted symbols.
- reloading.mdx: Uses `/movies` pedagogically; no links to non-existent pages.
- render-page.mdx: Full stack example in lines 50-79 uses correct imports and abstract paths.
- deployment.mdx: No app-specific examples or cross-links.
- vite-config.mdx: No app-specific examples or cross-links.

## Issue categories by type

- **Demo reference fixes (routing deleted surfaces)**: structure.mdx, routes.mdx, streaming.mdx, layouts.mdx
- **API example redesign (spawn-issue)**: index.mdx (entire intro, plus demo rewrite)

## Concerns

1. The intro page (index.mdx) is the critical concern: both the API example and the demo surface are outdated. This needs a full redesign, hence "spawn-issue" flag. Per the plan, Task 16 will rewrite index.mdx entirely, so this may be intentional (audit-only). Confirm intent before Task 15.

2. The deleted `/watched` and `/test` routes appear in 4 docs pages. The plan notes `/movies` is still valid pedagogically; the cleaning is focused on the deleted surface routes. Confirmed.

3. No transitive package imports found (@hono-preact/iso, @hono-preact/server, @hono-preact/vite); all examples use correct surface (hono-preact, hono-preact/server, hono-preact/vite).

4. No deleted symbols found (createGuard, useLoaderData, cacheRegistry, serverGuards, clientGuards, etc.). All symbol usage is current.
