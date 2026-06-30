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

async function* activityStream({
  signal,
}: LoaderCtx): AsyncGenerator<ActivityEvent, void, unknown> {
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
  signal.addEventListener('abort', onAbort);
  // Tracked across iterations so it is cleared after each race wins and once more
  // in `finally`: on disconnect `wake()` resolves the race, but the pending
  // setTimeout would otherwise dangle until it fires (a harmless no-op here, but
  // a per-subscription timer leak if this pattern is copied to a long-lived server).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    while (!signal.aborted) {
      while (queue.length) yield queue.shift()!;
      const tick = 4000 + Math.floor(Math.random() * 4000);
      await Promise.race([
        wakeP,
        new Promise<void>((r) => {
          timer = setTimeout(r, tick);
        }),
      ]);
      clearTimeout(timer);
      wakeP = new Promise<void>((r) => (wake = r));
      if (signal.aborted) break;
      if (queue.length === 0) {
        const e = simulateActivity();
        if (e) yield e;
      }
    }
  } finally {
    clearTimeout(timer);
    unsub();
    signal.removeEventListener('abort', onAbort);
  }
}

export const serverLoaders = {
  default: defineLoader(async (ctx) => {
    const user = await currentUser(ctx.c);
    const projects = listProjects().map((p) => ({
      ...p,
      taskCount: listTasksForProject(p.id).length,
    }));
    return { user, projects } satisfies ShellData;
  }),
  activity: defineLoader(activityStream, { live: true }),
};
