// apps/site/src/demo/activity-sim.ts
// Fabricated teammate activity for the demo bar's streaming heartbeat. Events
// reference real existing tasks but are display-only: they do NOT mutate the
// store. Limited to moves/comments so every event has a real taskId (a
// fabricated create would need a fake id).
import { publish } from 'hono-preact';
import { listAllTasks, type TaskStatus } from './data.js';
import {
  taskMovedEvent,
  commentAddedEvent,
  activityChannel,
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

// ---------------------------------------------------------------------------
// Heartbeat: while at least one activity stream is connected, publish a
// fabricated teammate event on the channel every 4-8 seconds so the demo bar
// always has motion. Refcounted so concurrent streams share one timer and the
// timer stops when the last stream disconnects.

let holders = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleTick(): void {
  timer = setTimeout(
    () => {
      const e = simulateActivity();
      if (e) publish(activityChannel.key(), e);
      if (holders > 0) scheduleTick();
    },
    4000 + Math.floor(Math.random() * 4000)
  );
}

/** Acquire the simulated-activity heartbeat. Returns an idempotent release. */
export function acquireSimHeartbeat(): () => void {
  holders++;
  if (holders === 1) scheduleTick();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    if (holders === 0 && timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

/** Test-only reset: drop all holders and any pending timer. */
export function __resetSimHeartbeatForTesting(): void {
  holders = 0;
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}
