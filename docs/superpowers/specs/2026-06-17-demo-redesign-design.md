# Demo redesign: kanban task board

Date: 2026-06-17
Status: Approved (brainstorm complete; ready for implementation plan)

## Goal

Turn the `/demo` mini issue tracker into a high-fidelity kanban task board that
is genuinely beautiful and dogfoods more of the features the framework has
shipped. The demo is the storefront: it should make a visitor want to build
with `hono-preact`. It stays an in-memory, per-process showcase (no real
persistence, resets on cold start).

## Locked decisions (from the brainstorm)

1. **Board organization:** columns are status; within each column cards sort by
   priority (highest first). Classic Linear/Trello shape. (Not priority
   swimlanes.)
2. **Information architecture:** a per-project board inside an app shell. A
   persistent left sidebar lists projects and the signed-in user; the main area
   is the selected project's board.
3. **Changing a task's state:** drag-and-drop *and* a per-card Menu / right-click
   ContextMenu, both firing the same optimistic action.
4. **Task detail:** a full-page route (kept), with the card morphing into the
   detail header via view transitions.
5. **Creating a task:** in a Dialog, not a page.
6. **Domain rename:** `Issue` becomes `Task` throughout the demo.
7. **New-task Dialog fields:** Title, Description, Priority (Select), Status
   (Select), Assignee (Combobox with type-to-search).
8. **Drag-and-drop:** pointer-events implementation (smooth, mouse + touch, all
   current browsers), isolated in a demo-only hook. Not a framework primitive.
9. **Tooltips** on card affordances (assignee avatar, priority dot, the `⋯`
   trigger).

## Domain and data model (`apps/site/src/demo/data.ts`)

Rename `Issue` to `Task` and `issues` to `tasks` across the demo (data, server
modules, components, copy, tests). `Project`, `User`, `Comment` stay; `Comment`
gets `issueId` renamed to `taskId`.

`Task` fields:

- `id`, `projectId`, `authorId` (unchanged)
- `assigneeId: string | null` (new)
- `title`, `body` (unchanged)
- `status: 'backlog' | 'in_progress' | 'in_review' | 'done'` (replaces
  `'open' | 'closed'`)
- `priority: 'urgent' | 'high' | 'medium' | 'low'` (new)
- `createdAt` (unchanged)

Seed data: keep the two existing long comment threads (so the streaming comments
loader still has visible material) and expand to roughly four to six tasks per
project, spread across all four statuses and the four priorities, with assignees
set. Deterministic timestamps as today.

Reads: existing list/get helpers, renamed and extended (e.g. `listTasksForProject`
returns tasks for grouping; group/sort happens on the client).

Writes:

- `createTask(author, { projectId, title, body, priority, status, assigneeId })`
- `setTaskStatus(taskId, status)`
- `setTaskPriority(taskId, priority)`
- `deleteTask(taskId)`
- `addComment(author, { taskId, body })` (renamed param)

Activity feed: keep `activityForProject`; add a `task-moved` kind so status
changes appear in the feed alongside `task-created` and `comment-added`.

Guard: `pages/demo/issue-guards.ts` becomes `task-guards.ts`; `assertCanClose`
becomes `assertCanMoveToDone` (only the author or assignee may move a task to
`done`). This keeps the page-guard showcase on a meaningful transition; the move
action calls it and the optimistic update reverts on the 403.

## Routing and app shell (`apps/site/src/routes.ts`)

```
/demo                        demo-layout.tsx (VT-direction host, unchanged)
  ''                         index.tsx (light restyled intro)
  login                      login.tsx + login.server.ts (restyled)
  projects                   projects-shell.tsx (sidebar layout)
                             + projects-shell.server.ts (sidebar loader)
                             use: requireSession   (unchanged guard)
    ''                       projects.tsx ("select a project" empty state)
    :projectId               project-header.tsx (title + breadcrumb + New task)
      ''                     project-board.tsx + project-board.server.ts
      tasks/:taskId          task.tsx + task.server.ts (detail)
```

The sidebar is a **layout-level loader** on the `projects` group node: a `server`
module declared alongside the `layout`, consumed in the layout component via
`loader.View()` / `.useData()`. It returns the current user plus all projects
with task counts, runs once for the group, and caches across child route changes.
This is supported and documented (`packages/iso/src/pages/docs/loaders.mdx`
layout-level loaders section; `layouts.mdx` layout `server` example) and is a new
feature for the demo to exercise. The active project is derived from
`useParams('/demo/projects/:projectId')`; the logout action lives in the shell.

The `:projectId` group keeps a thin layout (`project-header.tsx`) for the project
title, breadcrumb, and the New-task trigger, so that bar persists across the
board and the task-detail child. Card-to-header morph uses `ViewTransitionName`
on `task-title-${id}` / `task-status-${id}` (the existing technique).

## Components (`apps/site/src`)

New:

- `pages/demo/projects-shell.tsx` + `projects-shell.server.ts` (sidebar layout +
  loader)
- `pages/demo/project-header.tsx` (project top bar; hosts the New-task Dialog
  trigger)
- `pages/demo/project-board.tsx` + `project-board.server.ts` (board view; tasks
  loader; `createTask`, `setTaskStatus`, `setTaskPriority`, `deleteTask` actions)
- `components/demo/Board.tsx`, `Column.tsx`, `TaskCard.tsx`
- `components/demo/NewTaskDialog.tsx` (Dialog + Form + pickers)
- `components/demo/TaskActions.tsx` (shared Menu + ContextMenu: Move to (status
  radio group), Set priority (radio group), Delete (destructive item))
- `components/demo/pickers.tsx` (PrioritySelect, StatusSelect on Select;
  AssigneeCombobox on Combobox)
- `hooks/useBoardDrag.ts` (demo-only pointer-events drag; clearly labeled as not
  a framework primitive)
- a pure `groupTasks(tasks)` helper (group by status, sort by priority) that is
  unit tested

Reworked:

- `pages/demo/project-layout.tsx` becomes `project-header.tsx`
- `pages/demo/issue.tsx` becomes `task.tsx`; `issue.server.ts` becomes
  `task.server.ts`
- `pages/demo/projects.tsx` becomes the in-shell empty-state landing
- `components/demo/CommentList.tsx` (rename issue references to task)

Deleted:

- `components/demo/IssueRow.tsx` (replaced by `TaskCard`)

## Data flow

- **Sidebar:** group loader returns `{ user, projects: [...with counts] }`.
  Active highlight from `useParams`. Logout action as today.
- **Board:** board loader returns the project's tasks. `groupTasks()` produces
  the four ordered columns on the client.
- **New task:** `NewTaskDialog` controls open state (Dialog's own state or
  `useControllableState`); a `Form` bound to `createTask` submits Title, body,
  priority, status, assignee; on success the dialog closes and the board loader
  is invalidated (optionally optimistic insert). Pickers are Select/Combobox.
- **Move / reprioritize:** both the drag drop and the Menu/ContextMenu call the
  same `useOptimisticAction(setTaskStatus)` (and `setTaskPriority`) so the card
  relocates instantly and reverts on error. Drag and menu share one code path.
- **Task detail:** unchanged in spirit, renamed: issue-first load, then comments
  (streaming async-generator loader, optimistic append) and activity in
  parallel; status toggle via optimistic action; guard on move-to-done.

## Dogfood inventory

UI library, all new to the demo: **Dialog** (new task), **Select** x2
(priority, status), **Combobox** (assignee, type-to-search), **Menu** +
**ContextMenu** (card actions), **Tooltip** (card affordances).

Framework, already used and kept: nested routes, `requireSession` guard, typed
`useParams` / `buildPath`, `Form` / `useFormStatus` / `useActionResult`,
`useOptimisticAction`, streaming async-generator loader (comments), view
transitions (card-to-header morph + directional nav), `usePrefetch`.

Framework, newly added: **layout-level loader** (sidebar), and the page-guard on
the move-to-done transition.

## Drag-and-drop (Option 2: pointer events)

A single demo-only hook (`useBoardDrag`) built on Pointer Events: pointer-down on
a card starts a drag after a small threshold, a styled drag image follows the
pointer, columns highlight as drop targets, and dropping calls the shared
`setTaskStatus` optimistic action. Works with mouse and touch on all current
browsers (Pointer Events are Baseline Widely Available). It is explicitly not a
framework primitive; the Menu/ContextMenu remains the accessible and
keyboard-friendly path so we never depend on drag alone. Optionally wrap the drop
commit in a view transition for a settle animation (nice-to-have, not required).

## Error handling

- Optimistic moves and the status toggle auto-revert on failure (for example the
  move-to-done guard 403) and surface an inline message on the affected card or
  the detail header (the existing inline-error pattern in the issue page).
- The New-task Dialog form surfaces validation/denial via `useActionResult` (the
  existing login pattern).
- Board, comments, and activity each render loading fallbacks; the board shows
  skeleton columns.

## Styling and visual system

Match the site's brand tokens (magenta accent `#c40076` / brighter on dark,
ink, muted, border, surface-subtle). Add priority badge utilities and tokens to
`apps/site/src/styles/root.css` for **both** light and dark, each pairing a
surface with an AA-contrast foreground (mirroring the existing `badge-success` /
`badge-neutral` utilities). Board, columns, cards, and the shell use Tailwind
utilities over those tokens. Note: `format:check` does not cover `.css`, so the
CSS additions need a manual review pass; pick real existing token names rather
than guessing.

## Testing and CI

- Update `apps/site/src/demo/__tests__` for the renamed model, new
  fields/statuses/priorities, and new writes.
- Add tests for `task-guards` (`assertCanMoveToDone`) and the pure
  `groupTasks()` grouping/sort function.
- Drag *interaction* is not unit tested (hard to drive headlessly); its pure
  logic is extracted into testable functions.
- Run the full six-step pre-push gate in CI order: framework build,
  `format:check`, `typecheck`, `test:coverage`, `test:integration`, site build.
  Watch cross-package test fallout (a public-API-adjacent change must run the
  consuming package's suite) and the client-size comment: the `/demo` bundle
  grows as Dialog/Select/Combobox/Menu are pulled in, which is acceptable because
  the demo is code-split under `/demo`.

## Phasing (input to the implementation plan)

1. Data model + sidebar shell (layout loader) + static board read (no DnD).
2. New-task Dialog + Select/Combobox pickers.
3. Card Menu/ContextMenu + optimistic moves + priority changes.
4. Drag-and-drop (pointer events).
5. Task-detail refresh (rename + morph) + Tooltips + visual polish + tests.

Each phase is independently reviewable.

## Non-goals / out of scope

- Real persistence or a real auth provider (stays in-memory, signed-cookie demo).
- Cross-project / global board and swimlane layouts (per locked decisions).
- A toast/notification system (the library ships none; errors surface inline).
- Reordering tasks within a column by drag (drag changes status only; order is
  by priority). Can be a follow-up.
- New framework primitives (the drag hook lives in the demo only).
