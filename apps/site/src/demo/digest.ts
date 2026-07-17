import { PRIORITIES, type Project, type Task } from './data.js';

// One digest line per project: open-vs-total counts plus the highest-priority
// open task as the suggested next pick. Pure so the streaming action stays a
// thin generator around it.
export function projectDigestLine(project: Project, tasks: Task[]): string {
  const open = tasks.filter((t) => t.status !== 'done');
  const head = `${project.name}: ${open.length} open of ${tasks.length}`;
  if (open.length === 0) return head;
  const next = [...open].sort(
    (a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)
  )[0];
  return `${head} (next: ${next.title})`;
}
