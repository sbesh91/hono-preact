// apps/site/src/components/demo/TaskCard.tsx
import { usePrefetch, ViewTransitionName } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import type { Task, User } from '../../demo/data.js';
import { serverLoaders as taskLoaders } from '../../pages/demo/task.server.js';

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

type Props = { task: Task; projectSlug: string; assignee: User | null };

const TaskCard: FunctionComponent<Props> = ({
  task,
  projectSlug,
  assignee,
}) => {
  const href = `/demo/projects/${projectSlug}/tasks/${task.id}`;
  const prefetch = usePrefetch(href, taskLoaders.task);
  const done = task.status === 'done';

  return (
    <ViewTransitionName
      name={`task-card-${task.id}`}
      groupClass="task-card"
      render={
        <a
          href={href}
          onMouseEnter={prefetch}
          onFocus={prefetch}
          class="relative block rounded-lg border border-border bg-background p-2.5 pl-3 shadow-[0_1px_1px_rgba(37,40,42,.04)] hover:border-accent/40"
        />
      }
    >
      <span
        class="absolute inset-y-0 left-0 w-[3px] rounded-l-lg"
        style={{ background: `var(--color-priority-${task.priority})` }}
        aria-hidden
      />
      <ViewTransitionName
        name={`task-title-${task.id}`}
        groupClass="task-card"
        render={<p class="mb-2 pr-4 text-[12.5px] font-medium" />}
      >
        <span class={done ? 'line-through decoration-border' : ''}>
          {task.title}
        </span>
      </ViewTransitionName>
      <div class="flex items-center gap-1.5">
        <span
          class={`rounded-full px-1.5 py-px text-[10px] font-bold badge-${task.priority}`}
        >
          {PRIORITY_LABEL[task.priority]}
        </span>
        {assignee && (
          <span class="ml-auto grid h-[19px] w-[19px] place-items-center rounded-full bg-accent text-[9.5px] font-bold text-accent-foreground">
            {assignee.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    </ViewTransitionName>
  );
};
TaskCard.displayName = 'TaskCard';
export default TaskCard;
