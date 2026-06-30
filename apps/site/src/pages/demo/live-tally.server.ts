import {
  defineChannel,
  defineAction,
  serverRoute,
  liveStream,
  publish,
} from 'hono-preact';

// A signal-only live demo: `ping` publishes a bare wake (no payload, NO shared
// server state), and every connected tab's live loader re-runs on that wake. So
// each tab keeps its own honest tally of the updates IT received. This is the
// correct Cloudflare pattern: publish() syncs the EVENT cross-isolate, not state
// (module-level state is per-isolate on Workers, so a shared counter would
// desync). On Cloudflare the wake fans out cross-isolate through the realtime
// Durable Object (PR 5b), so a Ping in one tab ticks up every other tab even
// when they are served by different isolates.
const pingChannel = defineChannel('site-live-ping')();
const route = serverRoute('/demo/live-tally');

export const serverLoaders = {
  pings: route.loader(
    liveStream({
      topic: () => pingChannel.key(),
      // The wake is the whole signal; there is no shared value to read. An empty
      // payload keeps the loader a pure pass-through (the client counts arrivals).
      load: async (): Promise<Record<string, never>> => ({}),
    })
  ),
};

export const serverActions = {
  ping: defineAction<Record<string, never>, { ok: true }>(async () => {
    publish(pingChannel.key());
    return { ok: true };
  }),
};
