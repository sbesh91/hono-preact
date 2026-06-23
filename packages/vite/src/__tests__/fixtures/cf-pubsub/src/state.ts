import { defineChannel } from 'hono-preact';

// Shared in-memory demo state + the typed channel the live loader subscribes to
// and the test publish route publishes on. A plain (non-`.server`) module so it
// is importable from both src/data.server.ts and src/api.ts.
export const state = { count: 0 };
export const tallyChannel = defineChannel('cf-pubsub-tally')();
