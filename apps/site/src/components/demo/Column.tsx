// apps/site/src/components/demo/Column.tsx
import type { FunctionComponent } from 'preact';
import type { Column as ColumnModel } from '../../demo/group-tasks.js';
import type { User } from '../../demo/data.js';
import TaskCard from './TaskCard.js';
import type { PatchFn, RemoveFn } from './Board.js';

const DOT: Record<string, string> = {
  backlog: '#94a3b8',
  in_progress: 'var(--accent)',
  in_review: '#7c3aed',
  done: '#16a34a',
};

type Props = {
  column: ColumnModel;
  projectSlug: string;
  userById: Map<string, User>;
  onPatch: PatchFn;
  onRemove: RemoveFn;
};

const Column: FunctionComponent<Props> = ({
  column,
  projectSlug,
  userById,
  onPatch,
  onRemove,
}) => (
  <div class="rounded-xl bg-surface-subtle p-2.5">
    <div class="mb-2.5 flex items-center gap-2 text-[12.5px] font-semibold">
      <span
        class="h-2 w-2 rounded-full"
        style={{ background: DOT[column.status] }}
        aria-hidden
      />
      {column.label}
      <span class="ml-auto rounded-full border border-border bg-background px-1.5 text-[11px] font-semibold text-muted">
        {column.tasks.length}
      </span>
    </div>
    <div class="flex flex-col gap-2">
      {column.tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          projectSlug={projectSlug}
          assignee={
            task.assigneeId ? (userById.get(task.assigneeId) ?? null) : null
          }
          onPatch={onPatch}
          onRemove={onRemove}
        />
      ))}
    </div>
  </div>
);
Column.displayName = 'Column';
export default Column;
