// apps/site/src/components/demo/Board.tsx
import type { FunctionComponent } from 'preact';
import { groupTasks } from '../../demo/group-tasks.js';
import type { Task, User } from '../../demo/data.js';
import Column from './Column.js';

type Props = { tasks: Task[]; projectSlug: string; users: User[] };

const Board: FunctionComponent<Props> = ({ tasks, projectSlug, users }) => {
  const columns = groupTasks(tasks);
  const userById = new Map(users.map((u) => [u.id, u] as const));
  return (
    <div class="grid grid-cols-4 gap-3 overflow-x-auto p-4">
      {columns.map((column) => (
        <Column
          key={column.status}
          column={column}
          projectSlug={projectSlug}
          userById={userById}
        />
      ))}
    </div>
  );
};
Board.displayName = 'Board';
export default Board;
