// apps/site/src/demo/activity-sim.ts
// Fabricated teammate activity for the demo bar's streaming heartbeat. Events
// reference real existing tasks but are display-only: they do NOT mutate the
// store. Limited to moves/comments so every event has a real taskId (a
// fabricated create would need a fake id).
import { listAllTasks, type TaskStatus } from './data.js';
import {
  taskMovedEvent,
  commentAddedEvent,
  type ActivityEvent,
} from './activity-stream.js';

const SIM_ACTORS = ['Alice', 'Bob'];
const STATUSES: TaskStatus[] = ['backlog', 'in_progress', 'in_review', 'done'];

const pick = <T>(xs: readonly T[]): T =>
  xs[Math.floor(Math.random() * xs.length)];

export function simulateActivity(): ActivityEvent | null {
  const tasks = listAllTasks();
  if (tasks.length === 0) return null;
  const task = pick(tasks);
  const actor = pick(SIM_ACTORS);
  if (Math.random() < 0.6) {
    // STATUSES has 4 entries and we filter out exactly one (the current status),
    // so the array passed to pick is always non-empty (>= 3 choices).
    const to = pick(STATUSES.filter((s) => s !== task.status));
    return taskMovedEvent(task, to, actor, true);
  }
  return commentAddedEvent(task, actor, true);
}
