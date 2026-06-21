import {
  defineChannel,
  defineLoader,
  defineAction,
  serverRoute,
  publish,
} from 'hono-preact';

// In-process demo state. The Node adapter runs one process, so publish from the
// action reaches the live loader's subscription (cross-isolate fan-out needs the
// Durable-Object backend, a later release).
let count = 0;
const counter = defineChannel('counter')();
const route = serverRoute('/');

export const serverLoaders = {
  // Existing non-live greeting (unchanged behavior).
  default: defineLoader(async () => ({
    message: 'Hello from the Node adapter loader',
    renderedAt: new Date().toISOString(),
  })),
  // New: a live loader that re-pushes the count on every publish.
  count: route.liveLoader<{ count: number }>({
    topic: () => counter.key(),
    load: async () => ({ count }),
  }),
};

export const serverActions = {
  echo: defineAction<{ text: string }, { echoed: string }>(
    async (_ctx, input) => ({ echoed: input.text })
  ),
  increment: defineAction<Record<string, never>, { count: number }>(
    async () => {
      count += 1;
      publish(counter.key());
      return { count };
    }
  ),
};
