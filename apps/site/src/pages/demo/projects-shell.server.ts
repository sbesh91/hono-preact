import { defineLoader, type LoaderCtx } from 'hono-preact';
import {
  listProjects,
  listTasksForProject,
  type Project,
  type User,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';
import {
  subscribeActivity,
  recentActivityEvents,
  type ActivityEvent,
} from '../../demo/activity-stream.js';
import { simulateActivity } from '../../demo/activity-sim.js';

export type ShellData = {
  user: User | null;
  projects: (Project & { taskCount: number })[];
};

const shellLoader = async (ctx: LoaderCtx): Promise<ShellData> => {
  const user = await currentUser(ctx.c);
  const projects = listProjects().map((p) => ({
    ...p,
    taskCount: listTasksForProject(p.id).length,
  }));
  return { user, projects };
};

async function* activityStream(
  ctx: LoaderCtx
): AsyncGenerator<ActivityEvent, void, unknown> {
  for (const e of recentActivityEvents(5)) yield e;

  const queue: ActivityEvent[] = [];
  let wake!: () => void;
  let wakeP = new Promise<void>((r) => (wake = r));
  const unsub = subscribeActivity((e) => {
    queue.push(e);
    wake();
  });
  const onAbort = () => {
    unsub();
    wake();
  };
  ctx.signal.addEventListener('abort', onAbort);
  try {
    while (!ctx.signal.aborted) {
      while (queue.length) yield queue.shift()!;
      const tick = 4000 + Math.floor(Math.random() * 4000);
      await Promise.race([
        wakeP,
        new Promise<void>((r) => setTimeout(r, tick)),
      ]);
      wakeP = new Promise<void>((r) => (wake = r));
      if (ctx.signal.aborted) break;
      if (queue.length === 0) {
        const e = simulateActivity();
        if (e) yield e;
      }
    }
  } finally {
    unsub();
    ctx.signal.removeEventListener('abort', onAbort);
  }
}

export const serverLoaders = {
  default: defineLoader(shellLoader),
  activity: defineLoader(activityStream, { live: true }),
};
