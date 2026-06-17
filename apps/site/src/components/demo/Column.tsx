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
  registerEl: (el: HTMLElement | null) => void;
  onPointerDownCard: (taskId: string, e: PointerEvent) => void;
  draggingId: string | null;
  isOver: boolean;
  suppressClickRef: { current: boolean };
};

const Column: FunctionComponent<Props> = ({
  column,
  projectSlug,
  userById,
  onPatch,
  onRemove,
  registerEl,
  onPointerDownCard,
  draggingId,
  isOver,
  suppressClickRef,
}) => (
  <div
    ref={registerEl}
    class={`rounded-xl bg-surface-subtle p-2.5 transition-shadow${isOver ? ' ring-2 ring-accent/40' : ''}`}
  >
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
          onPointerDownCard={onPointerDownCard}
          draggingId={draggingId}
          suppressClickRef={suppressClickRef}
        />
      ))}
    </div>
  </div>
);
Column.displayName = 'Column';
export default Column;
