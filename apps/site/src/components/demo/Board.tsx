// apps/site/src/components/demo/Board.tsx
import type { FunctionComponent } from 'preact';
import { useRef } from 'preact/hooks';
import { useAction, useOptimisticAction } from 'hono-preact';
import { groupTasks, STATUS_COLUMNS } from '../../demo/group-tasks.js';
import type { Task, TaskStatus, TaskPriority, User } from '../../demo/data.js';
import {
  serverActions,
  serverLoaders,
} from '../../pages/demo/project-board.server.js';
import { useBoardDrag, type ColumnRect } from '../../hooks/use-board-drag.js';
import Column from './Column.js';

type Props = { tasks: Task[]; projectSlug: string; users: User[] };

export type PatchFn = (
  taskId: string,
  patch: { status?: TaskStatus; priority?: TaskPriority }
) => void;
export type RemoveFn = (taskId: string) => void;

const Board: FunctionComponent<Props> = ({ tasks, projectSlug, users }) => {
  const patch = useOptimisticAction(serverActions.patchTask, {
    base: tasks,
    apply: (current, payload) =>
      current.map((t) =>
        t.id === payload.taskId
          ? {
              ...t,
              ...(payload.status ? { status: payload.status } : {}),
              ...(payload.priority ? { priority: payload.priority } : {}),
            }
          : t
      ),
    invalidate: [serverLoaders.default],
  });
  const del = useAction(serverActions.deleteTask, {
    invalidate: [serverLoaders.default],
  });

  const doPatch: PatchFn = (taskId, p) => patch.mutate({ taskId, ...p });
  const doRemove: RemoveFn = (taskId) => del.mutate({ taskId });

  const colEls = useRef<Map<string, HTMLElement>>(new Map());
  const getColumnRects = (): ColumnRect[] =>
    STATUS_COLUMNS.map((c) => {
      const el = colEls.current.get(c.status);
      const r = el?.getBoundingClientRect();
      return {
        status: c.status,
        rect: { left: r?.left ?? 0, right: r?.right ?? 0 },
      };
    });
  const drag = useBoardDrag(getColumnRects, (taskId, to) =>
    doPatch(taskId, { status: to })
  );

  const columns = groupTasks(patch.value);
  const userById = new Map(users.map((u) => [u.id, u] as const));

  return (
    <div class="grid grid-cols-4 gap-3 overflow-x-auto p-4">
      {columns.map((column) => (
        <Column
          key={column.status}
          column={column}
          projectSlug={projectSlug}
          userById={userById}
          onPatch={doPatch}
          onRemove={doRemove}
          registerEl={(el: HTMLElement | null) => {
            if (el) colEls.current.set(column.status, el);
          }}
          onPointerDownCard={drag.onPointerDown}
          draggingId={drag.draggingId}
          isOver={drag.overStatus === column.status}
        />
      ))}
    </div>
  );
};
Board.displayName = 'Board';
export default Board;
