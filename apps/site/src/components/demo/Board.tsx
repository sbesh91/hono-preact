// apps/site/src/components/demo/Board.tsx
import type { FunctionComponent } from 'preact';
import { useAction, useOptimisticAction } from 'hono-preact';
import { groupTasks } from '../../demo/group-tasks.js';
import type { Task, TaskStatus, TaskPriority, User } from '../../demo/data.js';
import {
  serverActions,
  serverLoaders,
} from '../../pages/demo/project-board.server.js';
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
        />
      ))}
    </div>
  );
};
Board.displayName = 'Board';
export default Board;
