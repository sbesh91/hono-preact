import { defineChannel, defineAction, serverRoute, publish } from 'hono-preact';

// A shared, in-memory tally. The increment action publishes on the channel; the
// live loader re-pushes the new value to every connected tab. On Cloudflare the
// publish fans out cross-isolate through the realtime Durable Object (PR 5b), so
// two tabs on the deployed site update each other.
let count = 0;
const tallyChannel = defineChannel('site-live-tally')();
const route = serverRoute('/demo/live-tally');

export const serverLoaders = {
  count: route.liveLoader<{ count: number }>({
    topic: () => tallyChannel.key(),
    load: async () => ({ count }),
  }),
};

export const serverActions = {
  bump: defineAction<Record<string, never>, { count: number }>(async () => {
    count += 1;
    publish(tallyChannel.key());
    return { count };
  }),
};
