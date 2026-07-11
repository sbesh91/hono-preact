// apps/site/src/components/demo/TaskActions.tsx
import { Menu, ContextMenu } from 'hono-preact-ui';
import type { ComponentChildren } from 'preact';
import type { Task, TaskStatus, TaskPriority } from '../../demo/data.js';
import type { PatchFn, RemoveFn } from './Board.js';

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];
const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const itemCls =
  'cursor-pointer rounded-md px-2 py-1.5 text-[12.5px] data-[highlighted]:bg-accent/10';

// ContextMenu exposes Group, GroupLabel, RadioGroup, RadioItem, Separator, and
// Item (all backed by the same menu core parts), so `parts={ContextMenu}` works
// as-is. Verified in packages/ui/src/context-menu/index.ts.
function MenuBody({
  parts: P,
  task,
  onPatch,
  onRemove,
}: {
  parts: typeof Menu | typeof ContextMenu;
  task: Task;
  onPatch: PatchFn;
  onRemove: RemoveFn;
}) {
  return (
    <>
      <P.Group>
        <P.GroupLabel class="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
          Move to
        </P.GroupLabel>
        <P.RadioGroup
          value={task.status}
          onValueChange={(v) => onPatch(task.id, { status: v })}
        >
          {STATUSES.map((s) => (
            <P.RadioItem key={s.value} value={s.value} class={itemCls}>
              {s.label}
            </P.RadioItem>
          ))}
        </P.RadioGroup>
      </P.Group>
      <P.Separator class="my-1 h-px bg-border" />
      <P.Group>
        <P.GroupLabel class="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
          Priority
        </P.GroupLabel>
        <P.RadioGroup
          value={task.priority}
          onValueChange={(v) => onPatch(task.id, { priority: v })}
        >
          {PRIORITIES.map((p) => (
            <P.RadioItem key={p.value} value={p.value} class={itemCls}>
              {p.label}
            </P.RadioItem>
          ))}
        </P.RadioGroup>
      </P.Group>
      <P.Separator class="my-1 h-px bg-border" />
      <P.Item
        class={`${itemCls} text-danger`}
        onSelect={() => onRemove(task.id)}
      >
        Delete
      </P.Item>
    </>
  );
}

const popupCls =
  'demo-popup z-50 min-w-[11rem] rounded-lg border border-border bg-background p-1 text-foreground shadow-lg';

export function TaskMenu({
  task,
  onPatch,
  onRemove,
  children,
}: {
  task: Task;
  onPatch: PatchFn;
  onRemove: RemoveFn;
  children: ComponentChildren;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        class="grid h-5 w-5 place-items-center rounded text-muted hover:bg-foreground/10"
        aria-label="Task actions"
      >
        {children}
      </Menu.Trigger>
      <Menu.Positioner>
        <Menu.Popup class={popupCls} aria-label="Task actions">
          <MenuBody
            parts={Menu}
            task={task}
            onPatch={onPatch}
            onRemove={onRemove}
          />
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Root>
  );
}

export function TaskContextMenu({
  task,
  onPatch,
  onRemove,
  children,
}: {
  task: Task;
  onPatch: PatchFn;
  onRemove: RemoveFn;
  children: ComponentChildren;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Positioner>
        <ContextMenu.Popup class={popupCls} aria-label="Task actions">
          <MenuBody
            parts={ContextMenu}
            task={task}
            onPatch={onPatch}
            onRemove={onRemove}
          />
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Root>
  );
}
