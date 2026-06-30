import { serverRoute, liveStream } from 'hono-preact';
import { pingChannel } from './state.js';

const route = serverRoute('/');

// A channel-driven live loader. Each publish to the ping channel wakes it and it
// pushes a fresh chunk. On Cloudflare its subscription rides a worker->DO topic
// socket (PR 5b); a publish from any isolate fans out to it through the DO. The
// payload is just a marker: PR 5b syncs the wake EVENT, not shared state.
export const serverLoaders = {
  pings: route.loader(
    liveStream({
      topic: () => pingChannel.key(),
      load: async (): Promise<{ live: true }> => ({ live: true }),
    })
  ),
};
