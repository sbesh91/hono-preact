import { defineLoader, eventStream, type LoaderCtx } from 'hono-preact';
import {
  listProjects,
  listTasksForProject,
  type Project,
  type User,
} from '../../demo/data.js';
import { currentUser } from '../../demo/session.js';
import {
  activityChannel,
  recentActivityEvents,
  type ActivityEvent,
} from '../../demo/activity-stream.js';
import { acquireSimHeartbeat } from '../../demo/activity-sim.js';

export type ShellData = {
  user: User | null;
  projects: (Project & { taskCount: number })[];
};

// Backfill recent history, then stream every event published on the activity
// channel. The channel rides the framework's pub/sub layer, so on Cloudflare
// the feed sees publishes from other isolates. The heartbeat keeps fabricated
// teammate events flowing while at least one stream is connected.
async function* activityStream({
  signal,
}: LoaderCtx): AsyncGenerator<ActivityEvent, void, unknown> {
  for (const e of recentActivityEvents(5)) yield e;
  const release = acquireSimHeartbeat();
  try {
    for await (const e of eventStream(activityChannel.key(), signal)) {
      yield e;
    }
  } finally {
    release();
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
