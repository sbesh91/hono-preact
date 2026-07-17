// The framework restricts a `.server` module's runtime exports to the four
// server maps, so the board's shared insights cache and timing middleware
// live in this sibling module instead of project-board.server.ts.
import { createCache, defineServerMiddleware } from 'hono-preact';
import type { TaskStatus } from '../../demo/data.js';

// ---- Project insights (issue #282 P1: loader options showcase) ----

export type ProjectInsights = {
  total: number;
  byStatus: Record<TaskStatus, number>;
  /** Age in whole days of the oldest task not yet done. 0 when none. */
  oldestOpenDays: number;
  mode: 'quick' | 'deep';
};

// Explicit cache instance (the `cache` loader option): exported so tests and
// future controls can address the cache directly instead of only through
// ref.invalidate().
export const insightsCache = createCache<ProjectInsights>();

// The measurable body of the per-loader timing middleware, extracted so unit
// tests can drive it directly: a hand-built ServerCtx<'loader'> can't
// structurally satisfy Hono's Context (private fields make it effectively
// nominal), so the middleware's real work takes a plain setHeader callback
// instead of reaching into ctx.c itself.
export const timeLoader = async (
  setHeader: (name: string, value: string) => void,
  next: () => Promise<unknown>
): Promise<void> => {
  const started = performance.now();
  await next();
  const dur = Math.round(performance.now() - started);
  setHeader('Server-Timing', `insights;dur=${dur}`);
};

// Per-loader middleware (the `use` loader option): times the loader body and
// reports it as a Server-Timing entry on the RPC response, visible in the
// browser's network panel.
export const insightsTiming = defineServerMiddleware<'loader'>((ctx, next) =>
  timeLoader((name, value) => ctx.c.header(name, value), next)
);
