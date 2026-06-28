// apps/site/src/components/demo/TaskCard.tsx
import { usePrefetch, ViewTransitionName } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import type { Task, User } from '../../demo/data.js';
import { serverLoaders as taskLoaders } from '../../pages/demo/task.server.js';
import { MoreHorizontal } from 'lucide-preact';
import { TaskMenu, TaskContextMenu } from './TaskActions.js';
import type { PatchFn, RemoveFn } from './Board.js';
import { PRIORITY_BADGE, PRIORITY_LABEL } from './priority.js';
import { Tooltip } from 'hono-preact-ui';

type Props = {
  task: Task;
  projectSlug: string;
  assignee: User | null;
  onPatch: PatchFn;
  onRemove: RemoveFn;
  onPointerDownCard: (taskId: string, e: PointerEvent) => void;
  draggingId: string | null;
};

const TaskCard: FunctionComponent<Props> = ({
  task,
  projectSlug,
  assignee,
  onPatch,
  onRemove,
  onPointerDownCard,
  draggingId,
}) => {
  const href = `/demo/projects/${projectSlug}/tasks/${task.id}`;
  const prefetch = usePrefetch(href, taskLoaders.task);
  const done = task.status === 'done';
  const isDragging = draggingId === task.id;

  return (
    <TaskContextMenu task={task} onPatch={onPatch} onRemove={onRemove}>
      {/* Drag is pointer-only by design; the same status/priority moves are
          keyboard-operable via the ••• Menu and the right-click ContextMenu. */}
      <div
        data-task-id={task.id}
        class={`relative touch-none select-none rounded-lg ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={(e) => onPointerDownCard(task.id, e as PointerEvent)}
      >
        <ViewTransitionName
          name={`task-card-${task.id}`}
          groupClass="task-card"
          render={
            <a
              href={href}
              draggable={false}
              onMouseEnter={prefetch}
              onFocus={prefetch}
              onDragStart={(e) => e.preventDefault()}
              class="relative block rounded-lg border border-border bg-background p-2.5 pl-3 shadow-[0_1px_1px_rgba(37,40,42,.04)] hover:border-accent/40"
            />
          }
        >
          <span
            class="absolute inset-y-0 left-0 w-[3px] rounded-l-lg"
            style={{ background: `var(--color-priority-${task.priority})` }}
            aria-hidden
          />
          {/* The title is intentionally NOT a separate view-transition-name: it
              rides inside the card container morph (the `task-card-${id}` name on
              the <a> above). Naming it separately would lift it out of the card
              snapshot and dissolve a big heading into a small title in place. */}
          <p class="mb-2 pr-6 text-[12.5px] font-medium">
            <span class={done ? 'line-through decoration-border' : ''}>
              {task.title}
            </span>
          </p>
          <div class="flex items-center gap-1.5">
            <Tooltip.Root openDelay={300}>
              <Tooltip.Trigger
                render={
                  <span
                    class={`rounded-full px-1.5 py-px text-[10px] font-bold ${PRIORITY_BADGE[task.priority]}`}
                  />
                }
              >
                {PRIORITY_LABEL[task.priority]}
              </Tooltip.Trigger>
              <Tooltip.Positioner>
                <Tooltip.Popup class="demo-popup rounded-md bg-foreground px-2 py-1 text-[11px] text-background shadow">
                  {PRIORITY_LABEL[task.priority]} priority
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Root>
            {assignee && (
              <Tooltip.Root openDelay={300}>
                <Tooltip.Trigger
                  render={
                    <span class="ml-auto grid h-[19px] w-[19px] place-items-center rounded-full bg-accent text-[9.5px] font-bold text-accent-foreground" />
                  }
                >
                  {assignee.name.charAt(0).toUpperCase()}
                </Tooltip.Trigger>
                <Tooltip.Positioner>
                  <Tooltip.Popup class="demo-popup rounded-md bg-foreground px-2 py-1 text-[11px] text-background shadow">
                    {assignee.name}
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Root>
            )}
          </div>
        </ViewTransitionName>
        <div
          class="absolute right-1.5 top-1.5"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <TaskMenu task={task} onPatch={onPatch} onRemove={onRemove}>
            <MoreHorizontal size={14} />
          </TaskMenu>
        </div>
      </div>
    </TaskContextMenu>
  );
};
TaskCard.displayName = 'TaskCard';
export default TaskCard;
