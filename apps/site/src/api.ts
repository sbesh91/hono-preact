// apps/site/src/api.ts
// User Hono app, auto-mounted by the framework ahead of its own handlers.
// Hosts the SSE endpoint that drives the persistent demo activity bar.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  subscribeActivity,
  recentActivityEvents,
  type ActivityEvent,
} from './demo/activity-stream.js';
import { simulateActivity } from './demo/activity-sim.js';

const app = new Hono();

// Hybrid stream: real actions (echoed from the in-memory bus when same-isolate)
// race a 4-8s jittered timer that emits a simulated teammate event. The page is
// never blocked: this is opened by the client post-hydration.
app.get('/api/demo/activity', (c) =>
  streamSSE(c, async (stream) => {
    const queue: ActivityEvent[] = [];
    let wake!: () => void;
    let wakeP = new Promise<void>((r) => (wake = r));
    const unsub = subscribeActivity((e) => {
      queue.push(e);
      wake();
    });
    stream.onAbort(() => {
      unsub();
      wake(); // break the race promptly on disconnect
    });

    // Immediate backfill so the bar is populated on connect.
    for (const e of recentActivityEvents(5)) {
      await stream.writeSSE({ data: JSON.stringify(e) });
    }

    try {
      while (!stream.aborted) {
        while (queue.length) {
          await stream.writeSSE({ data: JSON.stringify(queue.shift()!) });
        }
        const tick = 4000 + Math.floor(Math.random() * 4000);
        await Promise.race([wakeP, stream.sleep(tick)]);
        wakeP = new Promise<void>((r) => (wake = r));
        if (stream.aborted) break;
        if (queue.length === 0) {
          // Timer path (no real event this round): emit a simulated one.
          const e = simulateActivity();
          if (e) await stream.writeSSE({ data: JSON.stringify(e) });
        }
        // queue non-empty -> loop top drains real events first.
      }
    } finally {
      unsub();
    }
  })
);

export default app;
