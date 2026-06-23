import { serverRoute } from 'hono-preact';
import { state, tallyChannel } from './state.js';

const route = serverRoute('/');

// A channel-driven live loader: re-pushes the count on every publish to the
// tally channel. On Cloudflare its subscription rides a worker->DO topic socket
// (PR 5b); a publish from any isolate fans out to it through the DO.
export const serverLoaders = {
  count: route.liveLoader<{ count: number }>({
    topic: () => tallyChannel.key(),
    load: async () => ({ count: state.count }),
  }),
};
