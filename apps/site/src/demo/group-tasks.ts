import type { Task, TaskStatus, TaskPriority } from './data.js';

export const STATUS_COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type Column = { status: TaskStatus; label: string; tasks: Task[] };

export function groupTasks(tasks: Task[]): Column[] {
  return STATUS_COLUMNS.map(({ status, label }) => ({
    status,
    label,
    tasks: tasks
      .filter((t) => t.status === status)
      .sort(
        (a, b) =>
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          a.createdAt - b.createdAt
      ),
  }));
}
