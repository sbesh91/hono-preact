# Demo View Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `apps/site` demo issue tracker a live showcase of the v0.4 View Transitions toolkit via directional page slides and two shared-element morphs.

**Architecture:** Pure presentational wiring. Add `:active-view-transition-type(...)` CSS to `root.css` for directional slides (the route-change dispatcher already emits `nav-push` / `nav-back` / `nav-forward`), and wrap a handful of demo elements in `<ViewTransitionName>` so the browser morphs them across navigations. No framework, data, or routing changes.

**Tech Stack:** Preact, `hono-preact` (`ViewTransitionName`), Tailwind v4 + plain CSS in `root.css`, Vite build.

---

## Verification strategy (read first)

These changes are presentational wiring of an already-tested toolkit (the `view-transition-name` hook and the direction-type dispatcher have unit + integration tests in `packages/iso`). There is **no meaningful unit test to add in the demo app**: a render test for `IssueRow` would pull in `issue.server.js` (a server module imported at the top of `IssueRow.tsx`) into a happy-dom client test, which is brittle, and it would only re-assert that the framework hook sets an inline style it already tests. So the verification gate for every task is:

1. `pnpm --filter '@hono-preact/*' --filter hono-preact build` (framework dist current — required for cross-package types).
2. `pnpm --filter site build` succeeds.
3. `pnpm format:check` (run `pnpm format` if it fails, then re-commit).

Manual visual verification is in Task 5. Do not invent unit tests for the wiring.

Run the framework build once before starting:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
```

Expected: builds succeed, `packages/iso/dist` is current.

---

## Task 1: Directional slide + card-morph CSS

**Files:**
- Modify: `apps/site/src/styles/root.css` (append after the existing `::view-transition-*(root)` fade block and its reduced-motion guard)

The existing file ends with a root fade and a `@media (prefers-reduced-motion: reduce)` block that zeroes `::view-transition-old(root)` / `::view-transition-new(root)`. Append the rules below **after** that final block. The direction-typed selectors carry one extra pseudo-class of specificity, so they override the base fade during push/back/forward and fall back to the fade on `nav-initial`.

- [ ] **Step 1: Append directional slide rules to `root.css`**

```css
/* --- Demo: directional page slides + shared-element card morph --- */
/* The route-change dispatcher emits nav-push / nav-back / nav-forward types on
   every navigation; key the root animation off them. Named elements (the issue
   title/badge and project name, below) are lifted out of the root snapshot and
   morph independently while the rest of the page slides. */

:active-view-transition-type(nav-push) ::view-transition-old(root),
:active-view-transition-type(nav-forward) ::view-transition-old(root) {
  animation: var(--spring-duration) var(--spring-soft) both slide-out-left;
}
:active-view-transition-type(nav-push) ::view-transition-new(root),
:active-view-transition-type(nav-forward) ::view-transition-new(root) {
  animation: var(--spring-duration) var(--spring-soft) both slide-in-right;
}
:active-view-transition-type(nav-back) ::view-transition-old(root) {
  animation: var(--spring-duration) var(--spring-soft) both slide-out-right;
}
:active-view-transition-type(nav-back) ::view-transition-new(root) {
  animation: var(--spring-duration) var(--spring-soft) both slide-in-left;
}

@keyframes slide-in-right {
  from {
    opacity: 0;
    transform: translateX(2rem);
  }
}
@keyframes slide-out-left {
  to {
    opacity: 0;
    transform: translateX(-2rem);
  }
}
@keyframes slide-in-left {
  from {
    opacity: 0;
    transform: translateX(-2rem);
  }
}
@keyframes slide-out-right {
  to {
    opacity: 0;
    transform: translateX(2rem);
  }
}

/* Shared-element morph timing for elements tagged groupClass="issue-card". */
::view-transition-group(.issue-card) {
  animation-duration: var(--spring-duration);
  animation-timing-function: var(--spring-soft);
}

@media (prefers-reduced-motion: reduce) {
  :active-view-transition-type(nav-push) ::view-transition-old(root),
  :active-view-transition-type(nav-forward) ::view-transition-old(root),
  :active-view-transition-type(nav-push) ::view-transition-new(root),
  :active-view-transition-type(nav-forward) ::view-transition-new(root),
  :active-view-transition-type(nav-back) ::view-transition-old(root),
  :active-view-transition-type(nav-back) ::view-transition-new(root) {
    animation: none;
  }
  ::view-transition-group(.issue-card) {
    animation-duration: 0s;
  }
}
```

- [ ] **Step 2: Build the site to confirm CSS is valid**

Run: `pnpm --filter site build`
Expected: build succeeds (no PostCSS/Tailwind errors).

- [ ] **Step 3: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format` and include the result in the commit.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/styles/root.css
git commit -m "feat(demo): directional view-transition slides + card-morph CSS"
```

---

## Task 2: Name the issue title + status badge in `IssueRow`

**Files:**
- Modify: `apps/site/src/components/demo/IssueRow.tsx`

Wrap the title `<a>` and the status `<span>` in `<ViewTransitionName>` using the `render` prop so the underlying tags, href, prefetch handlers, and classes are preserved (`useRender` merges the render element's props with the framework `ref` and uses the wrapper's children as the element's children). Each row's `issue.id` is unique on the list page, satisfying `view-transition-name` per-page uniqueness.

- [ ] **Step 1: Add `ViewTransitionName` to the import**

Change:

```tsx
import { prefetch } from 'hono-preact';
```

to:

```tsx
import { prefetch, ViewTransitionName } from 'hono-preact';
```

- [ ] **Step 2: Wrap the title link and status badge**

Replace the returned JSX (the `<li>...</li>` block) with:

```tsx
  return (
    <li class="border p-3 flex items-baseline justify-between">
      <ViewTransitionName
        name={`issue-title-${issue.id}`}
        groupClass="issue-card"
        render={
          <a
            href={href}
            onMouseEnter={onPrefetch}
            onFocus={onPrefetch}
            class="font-medium underline"
          />
        }
      >
        {issue.title}
      </ViewTransitionName>
      <ViewTransitionName
        name={`issue-status-${issue.id}`}
        groupClass="issue-card"
        render={
          <span
            class={`text-xs px-2 py-0.5 ${
              issue.status === 'open' ? 'bg-green-200' : 'bg-gray-200'
            }`}
          />
        }
      >
        {issue.status}
      </ViewTransitionName>
    </li>
  );
```

- [ ] **Step 3: Build the site**

Run: `pnpm --filter site build`
Expected: build + typecheck succeed (no JSX/type errors from the `render` props).

- [ ] **Step 4: Format check**

Run: `pnpm format:check`
Expected: PASS (run `pnpm format` and re-add if not).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/demo/IssueRow.tsx
git commit -m "feat(demo): name issue row title + badge for shared-element morph"
```

---

## Task 3: Match names on the issue detail header

**Files:**
- Modify: `apps/site/src/pages/demo/issue.tsx` (the `IssueHeaderAndActions` component's `<header>`)

Give the detail `<h2>` title and the status `<span>` the **same names** as the list row (`issue-title-${issue.id}`, `issue-status-${issue.id}`). The badge keeps using the optimistic `status` value for its text and color; only the `name` uses `issue.id`.

- [ ] **Step 1: Add `ViewTransitionName` to the `hono-preact` import**

Change the existing import block:

```tsx
import {
  definePage,
  Form,
  useFormStatus,
  useOptimisticAction,
  useActionResult,
} from 'hono-preact';
```

to add `ViewTransitionName`:

```tsx
import {
  definePage,
  Form,
  useFormStatus,
  useOptimisticAction,
  useActionResult,
  ViewTransitionName,
} from 'hono-preact';
```

- [ ] **Step 2: Wrap the header title and badge**

Replace this block inside `IssueHeaderAndActions`:

```tsx
        <div class="flex items-center gap-2">
          <h2 class="text-xl font-semibold">{issue.title}</h2>
          <span
            class={`text-xs px-2 py-0.5 ${
              status === 'open' ? 'bg-green-200' : 'bg-gray-200'
            }`}
          >
            {status}
          </span>
        </div>
```

with:

```tsx
        <div class="flex items-center gap-2">
          <ViewTransitionName
            name={`issue-title-${issue.id}`}
            groupClass="issue-card"
            render={<h2 class="text-xl font-semibold" />}
          >
            {issue.title}
          </ViewTransitionName>
          <ViewTransitionName
            name={`issue-status-${issue.id}`}
            groupClass="issue-card"
            render={
              <span
                class={`text-xs px-2 py-0.5 ${
                  status === 'open' ? 'bg-green-200' : 'bg-gray-200'
                }`}
              />
            }
          >
            {status}
          </ViewTransitionName>
        </div>
```

- [ ] **Step 3: Build the site**

Run: `pnpm --filter site build`
Expected: build + typecheck succeed.

- [ ] **Step 4: Format check**

Run: `pnpm format:check`
Expected: PASS (run `pnpm format` and re-add if not).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/demo/issue.tsx
git commit -m "feat(demo): match issue header title + badge names to list row"
```

---

## Task 4: Project-name morph (projects list → project header)

**Files:**
- Modify: `apps/site/src/pages/demo/projects.tsx` (project link in the list)
- Modify: `apps/site/src/pages/demo/project-layout.tsx` (header `<h1>`)

The project layout only has the slug from the route, and the projects list has `p.slug`, so key the shared name on the slug: `project-${slug}`. (The list shows the full project name and the layout shows the uppercased slug; the box morphs and the text crossfades, which is the intended effect.)

- [ ] **Step 1: Add `ViewTransitionName` to the `projects.tsx` import**

Change:

```tsx
import { definePage, useAction } from 'hono-preact';
```

to:

```tsx
import { definePage, useAction, ViewTransitionName } from 'hono-preact';
```

- [ ] **Step 2: Name the project link in `projects.tsx`**

Replace:

```tsx
            <a href={`/demo/projects/${p.slug}`} class="font-medium underline">
              {p.name}
            </a>
```

with:

```tsx
            <ViewTransitionName
              name={`project-${p.slug}`}
              render={
                <a
                  href={`/demo/projects/${p.slug}`}
                  class="font-medium underline"
                />
              }
            >
              {p.name}
            </ViewTransitionName>
```

- [ ] **Step 3: Add `ViewTransitionName` to the `project-layout.tsx` import**

Change:

```tsx
import { useRoute, useRouteChange } from 'hono-preact';
```

to:

```tsx
import { useRoute, useRouteChange, ViewTransitionName } from 'hono-preact';
```

- [ ] **Step 4: Name the header `<h1>` in `project-layout.tsx`**

Replace:

```tsx
        <h1 class="text-xl font-semibold uppercase">{slug}</h1>
```

with:

```tsx
        <ViewTransitionName
          name={`project-${slug}`}
          render={<h1 class="text-xl font-semibold uppercase" />}
        >
          {slug}
        </ViewTransitionName>
```

- [ ] **Step 5: Build the site**

Run: `pnpm --filter site build`
Expected: build + typecheck succeed.

- [ ] **Step 6: Format check**

Run: `pnpm format:check`
Expected: PASS (run `pnpm format` and re-add if not).

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/pages/demo/projects.tsx apps/site/src/pages/demo/project-layout.tsx
git commit -m "feat(demo): morph project name into project layout header"
```

---

## Task 5: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the demo locally**

Run: `pnpm --filter site dev` (or the project's documented dev command) and open `/demo/projects` in Chrome (View Transitions require a Chromium browser). Log in if the guard redirects to `/demo/login`.

- [ ] **Step 2: Walk the navigation and confirm each effect**

Confirm:
- Projects list → a project: the project name morphs up into the project header; the rest of the page slides in from the right.
- Project issues list → an issue: the clicked issue's title and status badge morph into the detail header; the rest slides in from the right.
- Browser/OS **back** from the issue: page slides in from the left (reverse direction); title/badge morph back down toward the list.
- The in-app "← all projects" link slides in the forward direction (expected per spec — link nav is classified as push, not back).

- [ ] **Step 3: Confirm reduced-motion**

In Chrome DevTools, Rendering panel → "Emulate CSS prefers-reduced-motion: reduce". Repeat the navigation and confirm there is no slide or morph motion (pages swap without animation).

- [ ] **Step 4: Final full-build gate**

Run, in order:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm --filter site build
```

Expected: all succeed.

---

## Self-review notes

- **Spec coverage:** Effect 1 (directional slides) → Task 1. Effect 2 (issue row → header morph) → Tasks 2 + 3. Effect 3 (project name → header morph) → Task 4. Accessibility/reduced-motion → Task 1 (CSS) + Task 5 step 3 (verify). Out-of-scope items (Persist, lifecycle) intentionally have no task.
- **Names are consistent across tasks:** `issue-title-${issue.id}` and `issue-status-${issue.id}` (Tasks 2 ↔ 3), `project-${slug}` (Task 4, list uses `p.slug`, layout uses `slug`), group class `issue-card` (Tasks 1, 2, 3). The CSS selector `::view-transition-group(.issue-card)` matches the `groupClass="issue-card"` prop.
- **No placeholders:** every code step shows the full before/after.
