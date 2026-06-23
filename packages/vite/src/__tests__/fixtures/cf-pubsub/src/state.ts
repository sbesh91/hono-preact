import { defineChannel } from 'hono-preact';

// The typed channel the live loader subscribes to and the test publish route
// publishes on. A plain (non-`.server`) module so it is importable from both
// src/data.server.ts and src/api.ts. No shared mutable state: PR 5b syncs the
// wake EVENT cross-isolate (each subscriber re-runs its load), not a value.
export const pingChannel = defineChannel('cf-pubsub-ping')();
