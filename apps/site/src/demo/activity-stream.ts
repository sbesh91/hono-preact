// apps/site/src/demo/activity-stream.ts
// Event model + typed channel for the persistent demo activity bar. Server
// actions publish real events on `activityChannel`; the shell's live loader
// subscribes via `eventStream`, so on Cloudflare the feed sees publishes from
// other isolates through the realtime Durable Object. Builders construct
// events; the data store stays a pure module and does not import this file.
import { defineChannel } from 'hono-preact';
import {
  listAllTasks,
  listComments,
  getProject,
  getUser,
  type Task,
  type TaskStatus,
} from './data.js';

type EventBase = {
  id: string;
  at: number; // epoch ms
  actor: string; // display name
  taskId: string;
  taskTitle: string;
  projectSlug: string;
  simulated: boolean; // true = fabricated teammate event (display-only)
};

export type ActivityEvent =
  | (EventBase & { kind: 'task-created' })
  | (EventBase & { kind: 'task-moved'; to: TaskStatus })
  | (EventBase & { kind: 'comment-added' });

/** The typed channel demo activity rides. `publish(activityChannel.key(), e)`
 * from an action; `eventStream(activityChannel.key(), signal)` in the shell's
 * live loader. */
export const activityChannel = defineChannel('demo-activity')<ActivityEvent>();

let counter = 0;
const nextId = (): string => `evt-${++counter}`;
const slugOf = (task: Task): string => getProject(task.projectId)?.slug ?? '';

export function taskCreatedEvent(
  task: Task,
  actor: string,
  simulated = false
): ActivityEvent {
  return {
    id: nextId(),
    kind: 'task-created',
    at: Date.now(),
    actor,
    taskId: task.id,
    taskTitle: task.title,
    projectSlug: slugOf(task),
    simulated,
  };
}

export function taskMovedEvent(
  task: Task,
  to: TaskStatus,
  actor: string,
  simulated = false
): ActivityEvent {
  return {
    id: nextId(),
    kind: 'task-moved',
    at: Date.now(),
    actor,
    taskId: task.id,
    taskTitle: task.title,
    projectSlug: slugOf(task),
    to,
    simulated,
  };
}

export function commentAddedEvent(
  task: Task,
  actor: string,
  simulated = false
): ActivityEvent {
  return {
    id: nextId(),
    kind: 'comment-added',
    at: Date.now(),
    actor,
    taskId: task.id,
    taskTitle: task.title,
    projectSlug: slugOf(task),
    simulated,
  };
}

// Derive a few most-recent events from the seeded store (across all projects)
// so a freshly-connected bar is immediately populated. Uses the historical
// timestamps (not Date.now), so the backfill reads as real history.
export function recentActivityEvents(limit = 5): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const task of listAllTasks()) {
    const projectSlug = slugOf(task);
    events.push({
      id: nextId(),
      kind: 'task-created',
      at: task.createdAt,
      actor: getUser(task.authorId)?.name ?? 'someone',
      taskId: task.id,
      taskTitle: task.title,
      projectSlug,
      simulated: false,
    });
    for (const c of listComments(task.id)) {
      events.push({
        id: nextId(),
        kind: 'comment-added',
        at: c.createdAt,
        actor: getUser(c.authorId)?.name ?? 'someone',
        taskId: task.id,
        taskTitle: task.title,
        projectSlug,
        simulated: false,
      });
    }
  }
  return events.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Test-only reset. Do not call from production code. */
export function __resetActivityForTesting(): void {
  counter = 0;
}
